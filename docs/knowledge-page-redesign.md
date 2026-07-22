# 知识管理页面改造设计（/knowledge）

> 状态：待评审
> 日期：2026-07-22

## 1. 目标

1. 将 /knowledge 页面 8 个 tab 简化为 3 个：**导入知识**、**管理知识**、**管理任务**
2. 导入知识以「工作流」模式呈现：导入 → 清洗 → 审查 → 通过
3. 「通过」与「发布上线」解耦：审查通过后进入待发布池，由管理员在「管理知识」中显式发布
4. 管理任务支持暂停 / 恢复 / 取消 / 删除
5. 主页面（聊天页）右上角为管理员提供「知识管理」「账户管理」小字快捷入口

## 2. Tab 结构映射

| 新 Tab | 吸收的旧 Tab | 说明 |
|--------|-------------|------|
| 导入知识 | 概览(精简)、来源管理、候选稿、评估、反馈 | 工作流视图，评估/反馈内嵌在审查环节（已有 review 页承载） |
| 管理知识 | 知识条目、联网知识源 | 待发布 + 已发布两个分区；联网知识源作为次级分区保留 |
| 管理任务 | 任务列表 | 增加暂停/恢复/删除 |

旧「概览」的统计卡片精简为导入知识 tab 顶部的 4 个工作流阶段计数，不再单独占一个 tab。

## 3. 状态机变更（核心后端改动）

### 3.1 现状

- draft: `pending_review` → approve 时**原子发布**（approve = publish）
- job: `queued → extracting → cleaning → pending_review → publishing → published`

### 3.2 新状态机

**Draft**：`pending_review` → `approved`（新增：通过但未发布）→ 发布后保持 `approved`，item 创建
**Job**：`queued → extracting → cleaning → pending_review → approved → publishing → published`

- 新增 job/draft 状态 `approved`（常量 `src/config/constants.ts`）
- 新增 job 状态 `paused`（仅 `queued` 可暂停，恢复回 `queued`）
- `drafts/[id]/approve` 改为仅标记通过（不再触发 publisher）
- 新增 `drafts/[id]/publish`：从「管理知识-待发布」触发，执行现有 publisher 全流程
- 兼容性：publisher 逻辑不变，只是触发点从 approve 挪到 publish

### 3.3 数据库

无需新表。`knowledge_jobs.status`、`knowledge_drafts.status` 为 text 字段，新增枚举值即可。SQLite 无枚举约束，仅改 constants + zod 校验。

## 4. Tab 一：导入知识

### 4.1 布局（自上而下）

```
[+ 添加知识]                                （右上角主按钮）

┌─ 工作流看板 ────────────────────────────────────────┐
│  ① 导入(n) ──→ ② 清洗中(n) ──→ ③ 待审查(n) ──→ ④ 已通过(n) │
└──────────────────────────────────────────────────┘

进行中的知识列表（按阶段过滤，默认全部未完成）
┌────────────────────────────────────────────────┐
│ 名称 | 来源类型 | 当前阶段(徽章) | 评估等级 | 提交时间 | 操作 │
└────────────────────────────────────────────────┘
```

### 4.2 工作流看板

- 4 个阶段卡片横向排列，箭头连接，各显示当前数量
  - **导入**：source 已创建、job `queued/extracting/paused`
  - **清洗中**：job `cleaning`（含 re_clean）
  - **待审查**：job `pending_review`
  - **已通过**：draft `approved` 未发布（近 7 天计数）
- 点击阶段卡片 = 过滤下方列表

### 4.3 添加知识

- 点击「+ 添加知识」弹出 Modal，复用现有 `SourceUploadForm`（文件拖拽 + URL 提交）
- 提交成功后 toast 提示并刷新看板

### 4.4 列表行操作（随阶段变化）

| 阶段 | 操作 |
|------|------|
| 导入/排队 | 暂停、取消 |
| 清洗中 | 查看进度 |
| 清洗失败 | 重试、删除 |
| 待审查 | **去审查**（跳转现有 `/knowledge/review/[draftId]`，含评估/反馈/重洗，全部复用） |
| 已通过 | 查看（跳转管理知识 tab） |

### 4.5 数据来源

复用现有 API：`/api/knowledge/jobs`、`/api/knowledge/stats`（stats 增加 workflow 阶段计数字段）。

## 5. Tab 二：管理知识

### 5.1 布局：三个分区（次级 pill 切换）

```
[待发布 (n)] [已发布 (n)] [联网知识源]
```

**分区一：待发布**（draft `approved` 且未发布）

| 列 | 操作 |
|----|------|
| 标题 / 分类 / 评估等级 / 通过时间 / 审查人 | **发布上线**（调新 publish API）、查看内容、驳回退审 |

**分区二：已发布**（现有 `ItemTable` 扩展）

| 操作 | 实现 |
|------|------|
| 下线 | 现有 archive API |
| 重新上线 | 现有 restore API |
| 删除 | **新增** `items/[id]` DELETE：归档态才可删，删 DB 记录 + wiki 文件 + git commit |
| 重新清洗 | 现有 revise API（派生新草稿走工作流） |
| 查看内容 | 现有 `ItemContentModal` |

**分区三：联网知识源**：整体复用现有 `WebSourceManager`，不改。

### 5.2 新增/调整 API

- `GET /api/knowledge/drafts?status=approved&unpublished=1` — 待发布列表（drafts 接口加过滤）
- `POST /api/knowledge/drafts/[id]/publish` — 发布（迁移原 approve 中的 publisher 调用）
- `POST /api/knowledge/drafts/[id]/unapprove` — 驳回退审（approved → pending_review）
- `DELETE /api/knowledge/items/[id]` — 删除已归档条目

## 6. Tab 三：管理任务

现有任务列表基础上：

| 操作 | 条件 | 实现 |
|------|------|------|
| 暂停 | `queued` | **新增** `jobs/[id]/pause`：status → `paused`，worker 不领取 |
| 恢复 | `paused` | **新增** `jobs/[id]/resume`：→ `queued` |
| 取消 | `queued/paused` | 现有 cancel API（放宽允许 paused） |
| 重试 | `failed` | 现有 retry API |
| 删除 | 终态（`published/rejected/failed/cancelled`） | **新增** `jobs/[id]` DELETE：删 job（级联清理孤儿 source/draft 文件） |

状态过滤器保留；默认展示全部，进行中置顶。

Worker 侧：`LeaseLoop` 领取条件已按 `status='queued'` 过滤，`paused` 天然不会被领取，无需改 worker。

## 7. 主页面管理员快捷入口

### 7.1 位置与形态

- `(app)/layout.tsx` 主内容区右上角，绝对定位小字链接（`text-xs text-gray-400 hover:text-gray-600`）：
  `知识管理 · 账户管理`
- 移动端：并入现有顶部 mobile header 右侧

### 7.2 权限显隐

- layout 已调用 `/api/auth/me`，拿到 `role`
- `admin`：显示「知识管理」+「账户管理」
- `knowledge_admin`：仅显示「知识管理」
- `user`：不显示

### 7.3 反向导航

- `AdminNav`（/admin 顶栏）追加「知识管理」链接，与「返回聊天」并列

## 8. 权限收紧（顺带）

`/knowledge` 目前任何登录用户可访问。改造时在 `(app)/knowledge` 页面级校验：非 `admin/knowledge_admin` 重定向 `/chat`（前端校验 + 现有 API 已有的服务端校验兜底）。

## 9. 改动清单

### 后端
1. `src/config/constants.ts` — 新增 `approved`、`paused` 状态
2. `drafts/[id]/approve/route.ts` — 去掉 publisher 调用，仅标记 approved
3. 新增 `drafts/[id]/publish/route.ts`、`drafts/[id]/unapprove/route.ts`
4. 新增 `jobs/[id]/pause`、`jobs/[id]/resume`、`jobs/[id]` DELETE
5. 新增 `items/[id]` DELETE
6. `stats/route.ts` — 增加工作流阶段计数
7. `drafts/route.ts` — 支持 `unpublished` 过滤

### 前端
8. `knowledge/page.tsx` — 重写为 3 tab 结构（拆分为 `ImportTab`、`ManageTab`、`TasksTab` 组件，瘦身主文件）
9. 新增 `components/knowledge/WorkflowBoard.tsx`（阶段看板）
10. 新增 `components/knowledge/AddKnowledgeModal.tsx`（包装 SourceUploadForm）
11. `(app)/layout.tsx` — 右上角管理员链接
12. `components/admin/AdminNav.tsx` — 追加知识管理链接

### 不动的部分
- review 页（`/knowledge/review/[draftId]`）及评估/反馈/重洗全套组件
- publisher、worker、extractors、llm-cleaner
- 数据库表结构

## 10. 风险与兼容

- **存量数据**：现有 approved draft 均已发布（有对应 item），待发布列表用 `approved 且无 item` 过滤，天然兼容
- **approve 语义变化**：review 页「通过」按钮文案改为「通过审查」，并提示需到管理知识发布
- **删除操作**：均为不可逆，前端二次确认（复用 ConfirmDialog）
