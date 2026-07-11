# iRacing AI 助手知识库 - 数据源梳理

> 目标：为面向新手和中等水平玩家的 iRacing AI 助手构建权威知识体系
> 日期：2026-07-11
> 策略：**Phase 1 优先采集 Web 网页文本源**（结构化、易抓取），Phase 2 再补充视频源（需字幕提取/转写）

---

# Phase 1：Web 网页数据源（优先采集）

## 一、赛道技术（悬挂、胎压、走线、刹车点等）

### 1.1 官方网页

| 来源 | URL | 内容说明 | 采集优先级 |
|------|-----|----------|-----------|
| iRacing Support Knowledge Base | https://support.iracing.com/ | 官方知识库，含 Getting Started、Driving School 等文字教程 | ★★★ |
| iRacing New Racer Guide | https://www.iracing.com/new-racer-guide/ | 官方新手指南：Test Drive、赛事模式、赛道学习流程 | ★★★ |
| iRacing Official Sporting Code | https://www.iracing.com/ (Resources 页) | 官方赛事规则、驾驶行为准则、安全评级（SR/iRating）体系说明 | ★★★ |
| iRacing 官方赛道页 | https://www.iracing.com/tracks/ | 所有激光扫描赛道介绍、配置信息、适用赛事 | ★★☆ |

### 1.2 英文社区

| 来源 | URL | 内容说明 | 采集优先级 |
|------|-----|----------|-----------|
| r/iRacing (Reddit) | https://www.reddit.com/r/iRacing/ | 全球最大 iRacing 社区，驾驶技巧、赛道攻略、setup 讨论、FAQ | ★★★ |
| RaceDepartment iRacing Forum | https://www.racedepartment.com/forums/iracing.128/ | 专业模拟赛车论坛，驾驶反馈区、技术讨论区 | ★★☆ |
| Driver61 官网 | https://scottmansell.co.uk/ | 前 F1 车手创办，Driver's University 文字教程、遥测工具 hotlaps.io | ★★☆ |

### 1.3 中文网页

| 来源 | URL | 内容说明 | 采集优先级 |
|------|-----|----------|-----------|
| HiPole 嗨跑赛车 (新手入门) | https://www.hipole.com/kb/videos-beginner/ | 国内最系统的 iRacing 中文教程：基础理论→圈速提升→出赛准备 | ★★★ |
| 什么值得买 iRacing 专栏 | https://post.smzdm.com/ (搜索 iRacing) | 入门设置教程、力反馈调校、硬件配置指南、购车/赛道推荐 | ★★☆ |
| 百度贴吧 iracing 吧 | https://tieba.baidu.com/f?kw=iracing | 国内玩家问答社区，新手提问、经验分享、问题解决 | ★☆☆ |

---

## 二、车辆调校（Setup 下载与调校知识）

### 2.1 专业平台

| 来源 | URL | 内容说明 | 采集优先级 |
|------|-----|----------|-----------|
| Garage 61 | https://garage61.net/ | 顶尖车手遥测数据 + Setup 对比平台，支持自动识别车辆赛道 | ★★★ |
| Coach Dave Academy | https://coachdaveacademy.com/ | iRacing Setup 教学、CDD vs VRS 对比、调校优化指南 | ★★★ |
| Virtual Racing School (VRS) | https://virtualracingschool.com/ | iRacing 遥测数据分析教学、圈速对比、驾驶技巧量化 | ★★☆ |
| RaceDepartment Setup 区 | https://www.racedepartment.com/forums/iracing.128/ (iRacing Setups) | 社区用户上传的免费 Setup，含评论区反馈 | ★★☆ |

### 2.2 调校教学 & 理论

| 来源 | URL | 内容说明 | 采集优先级 |
|------|-----|----------|-----------|
| iRacing Support KB (Setup 相关) | https://support.iracing.com/ | 官方教程中的车辆力学、悬挂参数、调校基础讲解 | ★★★ |
| Porsche × Max Benecke 调校指南 | https://newsroom.porsche.com/zh/2020/motorsports/cn-porsche-masterclass-part-9 | 职业车手讲解下压力、遥测分析、调校一致性方法论 | ★★☆ |
| Coach Dave Academy 教程 | https://coachdaveacademy.com/tutorials/ | Setup 优化教程、遥测对比工具使用指南 | ★★☆ |

### 2.3 辅助工具网站

| 工具 | URL | 功能说明 | 采集优先级 |
|------|-----|----------|-----------|
| SimHub | https://www.simhubdash.com/ | HUD 叠加层管理、遥测数据、胎压/胎温监控 | ★★☆ |
| Bloops | https://bloo.ps/ | 实时遥测对比训练（自动匹配最佳车手数据） | ★★☆ |
| MAIRA (Marvin's App) | https://herboldracing.com/ | 力反馈增强、方向盘手感优化 | ★☆☆ |
| OpenKneeboard | https://openkneeboard.com/ | VR 用户叠加层管理 | ★☆☆ |
| Crew Chief | 搜索 "Crew Chief sim racing" | 语音 Spotter、赛事工程师辅助 | ★☆☆ |
| Virtual Race Car Engineer | https://store.steampowered.com/app/523220 | 调校辅助工具：Lap Wizard 根据驾驶反馈推荐 Setup 改动 | ★☆☆ |

---

## 三、基础知识（车辆/赛道选购建议和官方玩法推荐等）

### 3.1 官方网页

| 来源 | URL | 内容说明 | 采集优先级 |
|------|-----|----------|-----------|
| iRacing New Racer Guide | https://www.iracing.com/new-racer-guide/ | 新手清单：免费车辆/赛道推荐、Rookie 系列入门路径 | ★★★ |
| iRacing Getting Started | https://support.iracing.com/ (Getting Started 分类, 12篇) | 账户创建、安装、界面导航、首场比赛指南 | ★★★ |
| iRacing 官方车辆页 | https://www.iracing.com/cars/ | 所有授权车辆信息、分类、性能参数 | ★★☆ |
| iRacing 官方赛事系列 | https://www.iracing.com/series/ | 50+ 官方系列赛介绍：Oval、Road、Dirt、Rally 分类 | ★★☆ |

### 3.2 选购建议 & 性价比指南

| 来源 | URL | 内容说明 | 采集优先级 |
|------|-----|----------|-----------|
| r/iRacing 购车指南帖 | https://www.reddit.com/r/iRacing/ (搜索 "what to buy") | 社区高频推荐的性价比车辆/赛道购买方案 | ★★★ |
| HiPole 新手入门系列 | https://www.hipole.com/kb/videos-beginner/ | 赛事内容与报名、硬件准备、目标管理、规则了解 | ★★★ |
| 什么值得买 iRacing 入门 | https://post.smzdm.com/ (搜索 iRacing 入门) | 订阅费用、车辆购买策略、赛照升级路径 | ★★☆ |

### 3.3 玩法 & 赛事体系

| 来源 | URL | 内容说明 | 采集优先级 |
|------|-----|----------|-----------|
| iRacing 官方赛事系列说明 | https://www.iracing.com/series/ | 50+ 官方系列赛介绍：Oval、Road、Dirt、Rally 分类 | ★★★ |
| iRacing 联赛系统 | 游戏内 League 功能 / iracing.com | 800+ 私人联赛、自建锦标赛指南 | ★★☆ |

---

## Phase 1 数据源优先级汇总

### 第一梯队（核心必采，权威且系统）
1. **iRacing 官方**：Support KB、New Racer Guide、Sporting Code、赛道/车辆/赛事页面
2. **r/iRacing Reddit**：全球最大社区，FAQ、购车指南、Setup 讨论、技术问答
3. **HiPole 嗨跑赛车**：国内最系统的中文入门教程体系
4. **Garage 61 + Coach Dave Academy**：遥测数据、Setup 教学、调校对比

### 第二梯队（重要补充，深度内容）
5. **RaceDepartment**：Setup 共享社区、技术论坛讨论
6. **什么值得买 iRacing 专栏**：中文入门设置、硬件配置、性价比指南
7. **Driver61 官网**：前 F1 车手的 Driver's University 文字教程
8. **Porsche × Max Benecke**：职业车手调校方法论

### 第三梯队（长尾补充）
9. 百度贴吧 iracing 吧
10. Virtual Racing School (VRS)
11. 各辅助工具官网（SimHub / Bloops / MAIRA 等）

---

# Phase 2：视频数据源（后续补充，需字幕提取/转写）

## 一、赛道技术类视频

| 频道/来源 | 平台 | 内容说明 | 采集优先级 |
|-----------|------|----------|-----------|
| iRacing Driving School (官方) | YouTube | 车辆力学、行驶线路、视线、刹车、降档、超车、比赛流程 | ★★★ |
| GITGUD Racing | YouTube | 逐弯赛道指南（刹车点、走线、档位），有 B站中文翻译版 | ★★★ |
| Suellio Almeida | YouTube / B站 | 四阶段练车法、驾驶风格分析、遥测数据解读，6000+ 学员 | ★★★ |
| MCSR (Sim Racing Coach) | YouTube | "停止盲目刷圈" 系统练习方法论 | ★★☆ |
| Noakesy Coaching | YouTube | iRacing 顶尖 1% 车手的 1v1 教学回顾 | ★★☆ |

## 二、车辆调校类视频

| 频道/来源 | 平台 | 内容说明 | 采集优先级 |
|-----------|------|----------|-----------|
| B站 "iRacing 调校" 系列 | B站 | 中文调校教学视频，含具体参数讲解 | ★★☆ |
| B站 "七个实用网站" 数据平台 | B站 (BV14MX6B9EGJ) | 介绍 Garage 61、SimHub、Bloops 等核心辅助工具 | ★★☆ |

## 三、基础知识类视频

| 频道/来源 | 平台 | 内容说明 | 采集优先级 |
|-----------|------|----------|-----------|
| B站 "新手必看入坑指南" | B站 | 订阅费用、免费内容、赛照升级路径 | ★★★ |
| 模拟赛车手中国SimRacer | B站 (space/25642632) | 15集入坑系列：方向盘校准→车载界面→赛事执照→安全分评级 | ★★☆ |
| B站 iRacing 赛道指南合集 | B站 | 大量中文赛道逐弯讲解（温顿、亚特兰大、铃鹿等） | ★★☆ |
| Jimmy Broadbent | YouTube | 模拟赛车 KOL（95万订阅），购车建议、设备评测 | ★☆☆ |
| ThePAWnisher | YouTube | 免费 iRacing 辅助工具推荐 | ★☆☆ |

---

## 下一步建议

1. **构建知识图谱**：将三大类内容拆解为子节点，关联对应数据源 URL，形成可检索的结构化知识
2. **Phase 1 数据采集**：按优先级批量抓取第一梯队网页文本内容（官方 KB、Reddit、HiPole、Garage 61 等）
3. **RAG 知识库搭建**：将采集的内容做 Embedding 索引，支持 AI 助手的检索增强生成
4. **Phase 2 视频转写**：对 Phase 2 视频源做字幕提取/语音转写，补充到知识库
5. **内容分类标注**：按用户场景（新手入门 / 提升圈速 / 调校优化 / 购车建议）打标签
