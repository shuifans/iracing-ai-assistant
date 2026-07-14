# 多轮对话性能诊断系统

## 概述

为 iRacing AI 助手的多轮对话功能添加完整的性能追踪和诊断测试能力，帮助定位响应时间过长或失败的根本原因。

## 功能特性

### 1. 后端链路追踪 (Pipeline Timing)

在 `/api/chat/messages` 的每个请求中，自动记录以下阶段的耗时：

- **authMs**: 鉴权验证（requireAuth + requireActiveUser）
- **loadContextMs**: 从数据库加载会话历史和上下文
- **loadAgentContextMs**: 构建 Agent 上下文（加载记忆、用户画像、Wiki 搜索）
- **agentConnectMs**: 连接到外部 Agent 服务（SDK 未暴露，当前为 0）
- **agentFirstByteMs**: 从发送请求到收到第一个 SSE 事件的时间
- **agentStreamMs**: Agent 流式传输整个响应的时间
- **saveMessageMs**: 保存助手消息和来源到数据库的时间
- **totalMs**: 从请求接收到流关闭的总时间

**实现位置**:
- `src/modules/chat/sse-events.ts` — `PipelineTiming` 接口定义
- `src/modules/chat/service.ts` — `streamChatMessage()` 中添加计时逻辑
- SSE `usage` 和 `done` 事件中包含 `timing` 字段

**日志输出**:
```
[ChatTiming] req=xxx session=xxx auth=5ms loadCtx=12ms agentCtx=8ms
[ChatTiming] req=xxx agentFirstByte=3420ms
[ChatTiming] req=xxx DONE firstByte=3420ms stream=28500ms save=45ms total=32000ms
[ChatTiming] req=xxx FAILED total=120000ms firstByte=N/Ams error=timeout
```

### 2. 诊断 API 端点

**端点**: `POST /api/chat/diagnostic`

**功能**: 自动运行多轮对话测试，返回详细的性能报告

**请求体**:
```json
{
  "questions": [
    "如何调整赛车刹车平衡以获得更好的入弯表现？",
    "轮胎压力对圈速有什么影响？应该如何调整？",
    "iRacing 的安全等级是如何计算的？"
  ],
  "sessionId": "可选，复用现有会话"
}
```

**响应结构**:
```json
{
  "data": {
    "sessionId": "新创建的测试会话 ID",
    "rounds": [
      {
        "round": 1,
        "question": "问题文本",
        "success": true,
        "timing": { /* PipelineTiming */ },
        "inputTokens": 1250,
        "outputTokens": 380,
        "durationMs": 32000,
        "responseLength": 1520,
        "sourceCount": 3
      }
    ],
    "summary": {
      "totalRounds": 5,
      "successCount": 4,
      "failCount": 1,
      "avgFirstByteMs": 3500,
      "avgTotalMs": 35000,
      "maxTotalMs": 85000,
      "minTotalMs": 18000,
      "totalTokens": 8500
    },
    "totalDurationMs": 180000,
    "timestamp": "2026-01-15T10:30:00Z"
  }
}
```

**实现文件**: `src/app/api/chat/diagnostic/route.ts`

### 3. 前端诊断测试页面

**路径**: `/chat/diagnostic`

**功能**:
- 可编辑的测试问题列表（默认 5 个）
- 一键运行多轮诊断测试
- 实时显示每轮测试状态
- 详细的性能摘要统计
- 逐轮结果表格，可展开查看详细信息
- 可视化链路耗水分解图
- 客户端 vs 服务端耗时对比
- 性能衰减分析（前半段 vs 后半段）

**访问方式**:
1. 侧边栏底部"多轮对话诊断"按钮
2. 直接访问 `/chat/diagnostic`

**实现文件**: `src/app/(app)/chat/diagnostic/page.tsx`

### 4. 聊天页面耗时显示

在每个完整的助手消息下方显示性能指标：

- **首字节时间** (绿色 <5s, 黄色 5-15s, 红色 >15s)
- **流式传输时间** (绿色 <20s, 黄色 20-60s, 红色 >60s)
- **总计时间** (绿色 <30s, 黄色 30-90s, 红色 >90s)
- **Token 使用量** (输入 → 输出)

**实现文件**:
- `src/components/chat/MessageBubble.tsx` — 显示 timing 信息
- `src/app/(app)/chat/[sessionId]/page.tsx` — 从 SSE 事件捕获 timing
- `src/modules/chat/types.ts` — `ChatMessage.timing` 字段

## 使用方法

### 快速诊断测试

1. 访问 `/chat/diagnostic`
2. 编辑测试问题（可选）
3. 点击"🚀 开始诊断测试"
4. 等待测试完成（默认 5 轮，约 2-3 分钟）
5. 查看性能摘要和逐轮结果

### 解读诊断结果

**性能摘要**:
- **成功率**: 成功轮数 / 总轮数（低于 100% 表示有失败）
- **平均首字节**: 用户等待第一个字的时间（目标 <5s）
- **平均总耗时**: 单轮平均响应时间（目标 <30s）
- **性能衰减**: 后半段 vs 前半段的耗时增长百分比
  - 正值表示性能随对话轮次下降
  - >30% 表示严重衰减（可能是上下文过大）

**逐轮详情**:
- 点击任意行展开详细信息
- 查看链路耗水分解图，找出瓶颈阶段
- 对比客户端 vs 服务端耗时，判断网络传输开销
- 查看错误信息（如果有）

### 常见问题诊断

**问题 1: 首字节时间过长 (>10s)**
- 检查 `agentFirstByteMs`
- 可能原因：
  - Agent 服务响应慢
  - Wiki 搜索/知识检索耗时
  - 模型推理延迟
- 解决：检查 Agent 服务状态，优化 Wiki 索引

**问题 2: 流式传输时间过长 (>60s)**
- 检查 `agentStreamMs`
- 可能原因：
  - 模型生成内容过长
  - Agent 服务性能问题
- 解决：限制输出长度，检查模型配置

**问题 3: 性能随轮次衰减**
- 检查 `degradationPercent`
- 可能原因：
  - 对话历史累积过大
  - 上下文窗口接近限制
- 解决：优化 `session-context.ts` 的历史裁剪策略

**问题 4: 请求失败**
- 检查 `error` 字段
- 常见错误：
  - `timeout`: Agent 服务超时（120s）
  - `AGENT_UNAVAILABLE`: Agent 服务不可用
  - `auth expired`: PAT 过期
- 解决：检查 Agent 服务、PAT 配置、网络连接

### 查看单条消息性能

在正常对话中，每个完整的助手消息底部会显示：
- 首字节时间
- 流式传输时间
- 总计时间
- Token 使用量

颜色编码：
- 🟢 绿色：性能良好
- 🟡 黄色：性能一般，可优化
- 🔴 红色：性能差，需要关注

## 技术细节

### 计时精度

- 使用 `performance.now()` 高精度计时（毫秒级）
- 服务端计时在 `streamChatMessage()` 中完成
- 客户端计时从发起 fetch 请求开始

### 数据传输

- Timing 数据通过 SSE `done` 和 `usage` 事件传递
- 前端解析后存储在 `ChatMessage.timing` 字段（仅客户端，不持久化）
- 诊断 API 通过消费 SSE 生成器收集 timing

### 性能开销

- 计时逻辑：极小（仅几次 `performance.now()` 调用）
- 数据传输：极小（每个请求增加约 100 字节）
- 诊断测试：正常对话负载（创建新会话）

## 文件清单

### 新增文件
- `src/app/api/chat/diagnostic/route.ts` — 诊断 API
- `src/app/(app)/chat/diagnostic/page.tsx` — 诊断测试页面

### 修改文件
- `src/modules/chat/sse-events.ts` — 添加 `PipelineTiming` 接口
- `src/modules/chat/service.ts` — 添加链路追踪和日志
- `src/modules/chat/types.ts` — 添加 `ChatMessage.timing` 字段
- `src/app/(app)/chat/[sessionId]/page.tsx` — 捕获 timing 数据
- `src/components/chat/MessageBubble.tsx` — 显示 timing 信息
- `src/components/chat/SessionSidebar.tsx` — 添加诊断入口

## 后续优化建议

1. **历史数据持久化**: 将 timing 数据存储到 `usage_events` 表，支持历史趋势分析
2. **告警机制**: 当首字节时间或失败率超过阈值时自动告警
3. **A/B 测试**: 对比不同模型、不同上下文策略的性能
4. **自动优化**: 根据性能数据自动调整历史裁剪策略
5. **分布式追踪**: 集成 OpenTelemetry，追踪 Agent 内部调用链
