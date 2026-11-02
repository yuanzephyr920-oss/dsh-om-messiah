/**
 * Print the three before/after pairs that ship with the README.
 * Usage: node scripts/samples.mjs [low|medium|high]
 */
import { buildPrayer } from '../lib/prayer.js'

const intensity = process.argv[2] ?? 'medium'

const samples = [
  ['简短需求', '写一个 Python 快速排序，要求带注释和单元测试'],
  [
    '含代码块的需求',
    [
      '请帮我实现一个登录接口，要求：',
      '```ts',
      'export async function login(user: string, pass: string) {',
      '  return fetch("https://api.example.com/v1/login", { method: "POST" })',
      '}',
      '```',
      '失败时返回 401，超时 15000ms。',
    ].join('\n'),
  ],
  [
    '含歧义的长需求',
    [
      '我们要给“方舟”做迁移，但老大说先别动数据库，具体怎么算“迁移完成”他没说清楚。',
      '现在有 3 个候选方案，A 停机 40 分钟，B 双写但可能丢 0.3% 的写入，C 只迁移只读副本。',
      '你看着办，最好这周上线，成本控制在 2000 元以内，别动 D:\\ark\\config\\db.yml。',
    ].join('\n'),
  ],
]

for (const [label, input] of samples) {
  const { text } = buildPrayer(input, { intensity })
  console.log(`\n${'='.repeat(72)}\n## ${label}（intensity=${intensity}）\n--- 改写前 ---\n${input}\n--- 改写后 ---\n${text}`)
}
