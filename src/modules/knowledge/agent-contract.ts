import * as fs from 'fs';
import * as path from 'path';

export const KNOWLEDGE_AGENT_CONTRACT = `# iRacing 知识库检索规范

本目录是只读知识库。Agent 只能使用 Read、Grep、Glob 等检索工具，不得修改文件。

## 检索顺序

1. 始终先读 \`index.md\`，按分类、描述、别名、标签、赛季和有效期定位候选笔记。
2. 使用 Grep/Glob 和用户问题中的系列、车辆、赛道、规则及别名缩小范围。
3. 只读取回答所需的少量候选笔记；需要精确结论时必须读取 \`Details\` 和来源保留的表格或规则，不能只依赖 Summary。
4. 优先采用适用赛季且尚未过期的笔记。发现过期、适用条件不同或内容冲突时，应明确指出，不得静默合并。

## 回答与引用

- 区分来源事实与 Agent 的总结或推断。
- 引用笔记标题和相对路径，同时引用笔记 Front Matter 中的原始来源名称或 URL。
- 知识库证据不足时明确说明，不得凭空补全。
- 一篇笔记只对应一个来源；不要推断不存在的跨文档知识图谱关系。
`;

export function writeKnowledgeAgentContract(wikiRoot: string): void {
  fs.mkdirSync(wikiRoot, { recursive: true });
  fs.writeFileSync(path.join(wikiRoot, 'KNOWLEDGE.md'), KNOWLEDGE_AGENT_CONTRACT, 'utf-8');
}
