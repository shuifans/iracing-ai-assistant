# iRacing AI 助手知识库 - 数据源梳理

> 目标：为面向新手和中等水平玩家的 iRacing AI 助手构建权威知识体系
> 日期：2026-07-11
> 策略：仅采集 Web 网页文本源（结构化、易抓取）

---

# Web 网页数据源

## 一、赛道技术（悬挂、胎压、走线、刹车点等）

### 1.1 官方网页

| 来源                           | URL                                      | 内容说明                                                   | 采集优先级 |
| ------------------------------ | ---------------------------------------- | ---------------------------------------------------------- | ---------- |
| iRacing Support Knowledge Base | https://support.iracing.com/             | 官方知识库，含 Getting Started、Driving School 等文字教程  | ★★★        |
| iRacing New Racer Guide        | https://www.iracing.com/new-racer-guide/ | 官方新手指南：Test Drive、赛事模式、赛道学习流程           | ★★★        |
| iRacing Official Sporting Code | https://www.iracing.com/ (Resources 页)  | 官方赛事规则、驾驶行为准则、安全评级（SR/iRating）体系说明 | ★★★        |
| iRacing 官方赛道页             | https://www.iracing.com/tracks/          | 所有激光扫描赛道介绍、配置信息、适用赛事                   | ★★☆        |

### 1.2 英文社区

| 来源               | URL                               | 内容说明                                                   | 采集优先级 |
| ------------------ | --------------------------------- | ---------------------------------------------------------- | ---------- |
| r/iRacing (Reddit) | https://www.reddit.com/r/iRacing/ | 全球最大 iRacing 社区，驾驶技巧、赛道攻略、setup 讨论、FAQ | ★★★        |

### 1.3 中文网页

| 来源                       | URL                                        | 内容说明                                                  | 采集优先级 |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------- | ---------- |
| HiPole 嗨跑赛车 (新手入门) | https://www.hipole.com/kb/videos-beginner/ | 国内最系统的 iRacing 中文教程：基础理论→圈速提升→出赛准备 | ★★★        |

---

## 二、车辆调校（Setup 下载与调校知识）

### 2.1 调校教学 & 理论

| 来源                            | URL                                                                            | 内容说明                                       | 采集优先级 |
| ------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- | ---------- |
| iRacing Support KB (Setup 相关) | https://support.iracing.com/                                                   | 官方教程中的车辆力学、悬挂参数、调校基础讲解   | ★★★        |
| Coach Dave Academy 教程         | https://coachdaveacademy.com/tutorials/                                        | Setup 优化教程、遥测对比工具使用指南           | ★★★        |
| Porsche × Max Benecke 调校指南  | https://newsroom.porsche.com/zh/2020/motorsports/cn-porsche-masterclass-part-9 | 职业车手讲解下压力、遥测分析、调校一致性方法论 | ★★☆        |

---

## 三、基础知识（车辆/赛道选购建议和官方玩法推荐等）

### 3.1 官方网页

| 来源                    | URL                                                       | 内容说明                                         | 采集优先级 |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------ | ---------- |
| iRacing New Racer Guide | https://www.iracing.com/new-racer-guide/                  | 新手清单：免费车辆/赛道推荐、Rookie 系列入门路径 | ★★★        |
| iRacing Getting Started | https://support.iracing.com/ (Getting Started 分类, 12篇) | 账户创建、安装、界面导航、首场比赛指南           | ★★★        |
| iRacing 官方车辆页      | https://www.iracing.com/cars/                             | 所有授权车辆信息、分类、性能参数                 | ★★☆        |
| iRacing 官方赛事系列    | https://www.iracing.com/series/                           | 50+ 官方系列赛介绍：Oval、Road、Dirt、Rally 分类 | ★★☆        |

### 3.2 选购建议 & 性价比指南

| 来源                 | URL                                                    | 内容说明                                     | 采集优先级 |
| -------------------- | ------------------------------------------------------ | -------------------------------------------- | ---------- |
| r/iRacing 购车指南帖 | https://www.reddit.com/r/iRacing/ (搜索 "what to buy") | 社区高频推荐的性价比车辆/赛道购买方案        | ★★★        |
| HiPole 新手入门系列  | https://www.hipole.com/kb/videos-beginner/             | 赛事内容与报名、硬件准备、目标管理、规则了解 | ★★★        |

### 3.3 玩法 & 赛事体系

| 来源                     | URL                              | 内容说明                                         | 采集优先级 |
| ------------------------ | -------------------------------- | ------------------------------------------------ | ---------- |
| iRacing 官方赛事系列说明 | https://www.iracing.com/series/  | 50+ 官方系列赛介绍：Oval、Road、Dirt、Rally 分类 | ★★★        |
| iRacing 联赛系统         | 游戏内 League 功能 / iracing.com | 800+ 私人联赛、自建锦标赛指南                    | ★★☆        |

---

## 数据源优先级汇总

### 第一梯队（核心必采，权威且系统）

1. **iRacing 官方**：Support KB、New Racer Guide、Sporting Code、赛道/车辆/赛事页面
2. **r/iRacing Reddit**：全球最大社区，FAQ、购车指南、Setup 讨论、技术问答
3. **HiPole 嗨跑赛车**：国内最系统的中文入门教程体系
4. **Coach Dave Academy**：Setup 教学、遥测对比工具使用指南

### 第二梯队（重要补充）

5. **Porsche × Max Benecke**：职业车手调校方法论

---

## 下一步建议

1. **构建知识图谱**：将三大类内容拆解为子节点，关联对应数据源 URL，形成可检索的结构化知识
2. **数据采集**：按优先级批量抓取第一梯队网页文本内容（官方 KB、Reddit、HiPole、Coach Dave Academy 等）
3. **RAG 知识库搭建**：将采集的内容做 Embedding 索引，支持 AI 助手的检索增强生成
4. **内容分类标注**：按用户场景（新手入门 / 提升圈速 / 调校优化 / 购车建议）打标签
