// 重新生成 index.md
import { rebuildIndex, writeIndex } from '../src/modules/knowledge/wiki-index';
const wikiRoot = './data/md-wiki';
const content = rebuildIndex(wikiRoot);
writeIndex(wikiRoot, content);
console.log(content);
