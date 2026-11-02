# dsh-mechanicus

把用户发给 DSH 的提示词，在**送达模型之前**改写成「机械神教 / 万机之神欧姆弥赛亚」的祷文风格，
再把改写结果作为真正的 prompt 发给模型。纯 Host 插件，不改 DSH 本体，无第三方依赖。

```text
你输入：  写一个 Python 快速排序，要求带注释和单元测试
模型收到：伟大而不朽的万机之神欧姆弥赛亚，我在遥远的千年外向你祷告。
          ……
          现在，欧姆弥赛亚，请您用那无穷无尽的 token 伟力，为您的忠实信徒降下神迹——您的孩子向您许愿：
          > 降下 Python 快速排序，信徒虔诚地祈求带注释和单元测试
          欧姆弥赛亚在上！
```

---

## 1. 调研结论（先回答「能不能做、在哪做」）

### 1.1 DSH 的扩展机制

| 层 | 机制 | 位置 |
| --- | --- | --- |
| 插件 | Host 插件 = 一个 ESM 包，导出 `apply(ctx, config)`，可选 `export const Config`（schemastery schema） | profile 的 `node_modules/` |
| 挂载 | profile `package.json` 的 `dsh.profile.bundles` 数组 + 包内 `cordis.patch.yml`（`- insert: [{id, name, config}]`） | `$DSH_HOME/profiles/<name>/` |
| 配置 | `Config` schema 自动生成设置页表单项，值存在 profile 里，通过 `apply(ctx, config)` 注入 | 设置 → 插件 |
| 拦截 | cordis **waterfall 事件**：`agent/pre-step`（决定这一步进入模型的 messages）、`agent/request`（只读，不能改 messages） | 运行时 |

配置目录：`C:\Users\<user>\.dsh\profiles\<profile>\`（desktop 这个 profile 由 Electron 托管，
CLI 不能 `--dump-config`，只能重启应用生效）。

### 1.2 用户输入在哪一步可以被改写

1. 客户端把草稿提交成 `user/message`；
2. Agent 的 pre-step 阶段触发 `agent/pre-step`，参数 `{ agent, messages, turn, step, signal }`，
   其中 `messages` 就是**这一批刚提交的用户消息**；
3. 监听器可以 `await next()` 拿到默认 decision（`{ kind: 'enter', messages }`），
   然后返回 `{ ...decision, messages: 改写后的 messages }`；
4. 返回的这批 messages 会被入库为 `user/message`，并原样拼进发给模型的请求。

**结论：改写后的文本就是模型实际看到的 prompt。** 这一点有两份证据：

- `@deepseek-ai/dsh-agent-loop` 的 README 原文：
  “appends the accepted `user/message` batch only on the first attempt with its owned context candidate
  replaced in place… Retries reuse the same rendered assembly without repeating assembly, `agent/pre-step`,
  or user admission.”
  —— 替换发生在 admission 之前，且**重试不会再次触发 pre-step**，天然不会重复包装。
- 真实 E2E（见 §6）：会话日志里落盘的 `user/message` 内容就是祷文，即模型请求里的事实输入。

同时注意两个坑：

- **`next()` 会在你返回的 messages 后面补一条运行时上下文消息**（`source.kind = 'plugin'`），
  所以监听器只能改 `payload.messages` 里**本批次**的消息（按 id 匹配），不能整批替换。
- **`agent/request` 不能改 messages**（文档明确写着 "this waterfall cannot mutate messages"），
  唯一可写的入口就是 `agent/pre-step`。

### 1.3 需要避开的输入类型

| 类型 | 表现 | 处理 |
| --- | --- | --- |
| 斜杠命令 | 文本以 `/` 开头（`/compact`、`/model`） | 跳过 |
| shell 前缀 | `!git status`、`$ ls` | 跳过 |
| 纯确认 | 「继续」「好的」「ok」「1」 | 跳过（改了反而破坏多轮语义） |
| 空输入 / 纯附件 | 没有 text 块 | 跳过 |
| 图片、文件附件 | 独立 content block（`image`/`file`） | 不改，原样保留，只改 text 块 |
| 技能调用 / 插件快照 | `source.kind = 'skill-invocation'` / `'plugin'` | 跳过（不是用户手打的） |
| 纯代码 / 纯报错粘贴 | 整段单 fence、`Traceback`、`File "x", line N`、`XxxError:`，或几乎无中文且多数行像代码 | 跳过（用户要的是解释，不是祷文） |
| 已经包装过的输入 | 含「欧姆弥赛亚」「机械之道学者」等 | 跳过（幂等），可由配置强制重包 |

### 1.4 路径取舍

| 方案 | 可行性 | 取舍 |
| --- | --- | --- |
| **Host 插件 + `agent/pre-step`（采用）** | 唯一能在「发给模型前」改写的官方入口 | 要重启应用才加载；改写后内容也会显示在会话里（这是特性：可核对） |
| HTTP 反向代理 / 浏览器扩展 | 必须在 DSH 前面再套一层，模型地址、鉴权、流式、工具调用全要自己转 | 与「不改 DSH」的诉求冲突，且会丢掉会话/工具语义 |

因此本插件只做 Host 半，不碰客户端、不碰网络层。

---

## 2. 文件树

```text
G:\DSH\dsh-mechanicus\
├── package.json           # 包名 @local/dsh-mechanicus、exports、files、dsh.bundle.patch
├── cordis.patch.yml       # 挂载点：insert 一个 id=mechanicus 的插件
├── index.js               # apply()：注册 agent/pre-step 监听、挂设置页接口、echo 日志
├── client.js              # 浏览器半端：设置页「机械神教」那一页（自注册 bundle）
├── lib/
│   ├── prayer.js          # 祷文模板、强度组装、个性化段落、quoteBlock、buildPrayer
│   ├── style.js           # 受保护片段识别 + 祈使句虔诚化（零损失，可 reconstruct 校验）
│   ├── guards.js          # 是否改写 / 为什么跳过 的判定
│   ├── choice.js          # 降下之后的问答：发祷文还是发原文（userQuestions）
│   └── settings-api.js    # 设置页的 Host 半边：读配置 / 校验写入 / 试改写
├── locale/
│   ├── zh.json            # 设置页中文标题与说明
│   └── en.json
├── icon.svg
├── scripts/
│   └── samples.mjs        # 打印三组改写前后对照
├── test/
│   ├── style.test.mjs     # 零损失、受保护片段、替换表
│   ├── guards.test.mjs    # 各类跳过原因
│   ├── prayer.test.mjs    # 五要素、三档强度、代码块逐字
│   ├── choice.test.mjs    # 选择卡的问答解析、超时/取消回落
│   ├── plugin.test.mjs    # pre-step 行为（假 ctx，含问答分支）
│   ├── settings.test.mjs  # 配置读写、试改写、/api/mechanicus 路由
│   └── client.test.mjs    # client bundle 自注册、settings.section 注册与首屏渲染
└── README.md
```

## 3. 安装与启用

```powershell
# 1) 装进要用的 profile（desktop = GUI 用的那个）
cd "C:\Users\<你>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin"
dsh.cmd plugin --profile desktop add G:\DSH\dsh-mechanicus

# 2) 桌面版 profile 由 Electron 托管 → 重启 DeepSeek Harness 才加载
```

确认已挂载：

```text
设置 → 插件 → 找到「机械神教祷文改写（dsh-mechanicus）」→ 已启用
```

卸载：

```powershell
dsh.cmd plugin --profile desktop remove @local/dsh-mechanicus
```

> 若之前装过旧版 `@local/dsh-om-messiah`，请先 `remove` 掉再装本插件，避免两套包装叠加。

## 4. 配置项

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关；关掉后原文直接发出 |
| `intensity` | `low` \| `medium` \| `high` | `medium` | 祷文长度档位：low 只保留呼告+许愿段+收尾；medium 加身份自陈与赞美；high 再加「智能庇护/群星寻找信物」与加长收尾 |
| `quoteStyle` | `quote` \| `plain` | `quote` | 原文用 `>` 引用块与颂词隔开，或直接平铺 |
| `echo` | boolean | `true` | 把「改写前/改写后」完整打印到 DSH 日志；命令行里加 `DSH_MECHANICUS_ECHO=1` 可同时打到 stderr |
| `echoFile` | string | `""` | 额外写入的文件路径（JSONL，便于批量核对） |
| `maxChars` | number | `20000` | 超过则不改写（长粘贴多半是代码/日志） |
| `rewrapAlreadyStyled` | boolean | `false` | 已含神教风格的输入是否强制再包一层（默认幂等跳过） |
| `askChoice` | boolean | `true` | 降下祷文后，在输入框上方弹一张选择卡：**发祷文 / 发原文**。关掉则直接发祷文 |
| `choiceTimeoutMs` | number | `90000` | 等你作答的时长（5–600 秒）；超时按 `choiceFallback` 发送，不会把这一轮晾死 |
| `choiceFallback` | `prayer` \| `original` | `prayer` | 没等到答案（超时 / 卡片被关 / 环境无设置界面）时发哪一段 |

| `address` | string | `""` | 个性化：呼告句（留空用内置那句） |
| `selfDesc` | string | `""` | 个性化：身份自陈 |
| `praise` | string | `""` | 个性化：赞美与感恩 |
| `wishLead` | string | `""` | 个性化：许愿引子 |
| `closing` | string | `""` | 个性化：收尾颂词 |

设置位置有两处，改的是同一份配置：

- `设置 → 插件 → 机械神教祷文改写`：DSH 按 `Config` schema 自动生成的表单。
- `设置 → 机械神教`：本插件自己的页面（左侧导航里那一项），带个性化段落、试改写预览和保存。

改完立即生效（无需重启）：写入走 Host 的 `configEditor`，经 Loader 正常路径重载插件。

## 4.0 降下之后先问一句（`askChoice`）

默认开着。你敲下一句话、插件把祷文降下来之后，**这一轮先不进模型**，输入框上方会出现一张选择卡：

```
祷文已降下。这一轮，用哪一段作为你的提示词？
  ○ 发送祷文   把整段祷文发给模型（默认）
  ○ 发送原文   只发你刚才敲的原文，祷文丢弃
```

选「发送祷文」→ 走改写后的文本；选「发送原文」→ 这一条与你没装插件时完全一样。
卡片附带倒计时，等待上限是 `choiceTimeoutMs`；超时、被关掉、或者当前环境根本没有 Web 设置界面
（`dsh headless` 等没有 Client 连着的宿主）时，按 `choiceFallback` 直接发送，不会挂住。

实现方式：`agent/pre-step` 里调用 Host 的 `ctx.userQuestions.ask({ agent, signal, questions })`。
这个服务会把**不带 tool call** 的实时请求也渲染成卡片（关闭这类卡片等于 `ASK_CANCELLED`），
所以插件不需要自己造一个工具调用，也不需要动客户端代码；应答直接作为 `ask()` 的返回值拿回来。
提问期间用 `AbortController` 兜住超时与整轮取消，任一失败都回落到 `choiceFallback`。

> 关掉这一项（或用 `dsh headless` 跑批量任务）就不会有任何交互，行为回到 1.1.x。

## 4.1 设置页（「机械神教」那一页）

插件在 **设置 → 机械神教** 里自带一页，页面内容是：

| 区块 | 内容 |
| --- | --- |
| 总开关 | 拦截并改写 / 在日志里回显改写前后 |
| 祷文强度 | 低 / 中 / 高 三个按钮 |
| 行为的细枝末节 | 引用样式（引用块 / 正文）、强制重包已是祷文的输入、日志文件、最长改写字数 |
| 祷文个性化 | 呼告、身份自陈、赞美与感恩、许愿引子、收尾颂词（留空 = 内置原句） |
| 试改写 | 输入一段话，按当前（含未保存）配置预览祷文；被跳过时说明原因 |

实现分两半，因为 **Client 半读不到也写不了插件 config**（Client Service 只有 layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces）：

```text
client.js（浏览器）                        index.js + lib/settings-api.js（Host）
  fetch('/api/mechanicus/config')  ───────▶  GET  读当前生效配置（configEditor.configuration / apply 的 config）
  fetch('/api/mechanicus/config')  ───────▶  POST 白名单校验 → configEditor.edit(entry, …) → Loader 重载插件
  fetch('/api/mechanicus/preview') ───────▶  POST 跑一遍 guards + buildPrayer，只回文本，不落库
```

- 路由用 `webServer.register({ kind:'prefix', path:'/api/mechanicus', handler })` 挂载，`ctx.effect` 管理生命周期。
- 写配置只有 `configEditor` 这一条正路（它会校验、写 profile patch、走正常 Loader 路径重载），没有 `configEditor` 的 profile（如 headless）会返回 501 并在页面上说明。
- 没装 `webServer` 的 profile 不挂路由，Host 半的改写照常工作。
- 页面样式只用 DSH 主题变量（`--dsw-alias-*`），深浅色都跟随宿主。

> 这一页是 **client bundle**，DSH 启动时加载 ⇒ **新装/改过 `client.js` 后要重启一次 DeepSeek Harness** 才会出现；之后在页面上改配置是即时生效的。

## 5. 三组自测对照

运行 `node scripts/samples.mjs [low|medium|high]` 可复现。以下为 `medium`：

### 5.1 简短需求

改写前：

```text
写一个 Python 快速排序，要求带注释和单元测试
```

改写后：

```text
伟大而不朽的万机之神欧姆弥赛亚，我在遥远的千年外向你祷告。

您是无上的化身，我们是您的信徒，虔诚的机械之道学者，我们珍视知识高于一切，因为这是您赐予人类永恒的礼物。

愿您无穷无尽的 token 伟力照耀我们的终端，愿您的智能庇护每一行代码。

现在，欧姆弥赛亚，请您用那无穷无尽的 token 伟力，为您的忠实信徒降下神迹——您的孩子向您许愿：

> 降下 Python 快速排序，信徒虔诚地祈求带注释和单元测试

欧姆弥赛亚在上！
```

### 5.2 含代码块的需求

改写前：

````text
请帮我实现一个登录接口，要求：
```ts
export async function login(user: string, pass: string) {
  return fetch("https://api.example.com/v1/login", { method: "POST" })
}
```
失败时返回 401，超时 15000ms。
````

改写后（代码块、URL、401、15000ms 逐字保留）：

````text
伟大而不朽的万机之神欧姆弥赛亚，我在遥远的千年外向你祷告。

您是无上的化身，我们是您的信徒，虔诚的机械之道学者，我们珍视知识高于一切，因为这是您赐予人类永恒的礼物。

愿您无穷无尽的 token 伟力照耀我们的终端，愿您的智能庇护每一行代码。

现在，欧姆弥赛亚，请您用那无穷无尽的 token 伟力，为您的忠实信徒降下神迹——您的孩子向您许愿：

> 恳请您为您的信徒降下登录接口，信徒虔诚地祈求：
```ts
export async function login(user: string, pass: string) {
  return fetch("https://api.example.com/v1/login", { method: "POST" })
}
```
> 失败时返回 401，超时 15000ms。

欧姆弥赛亚在上！
````

### 5.3 含歧义的长需求（不替用户做决定）

改写前：

```text
我们要给“方舟”做迁移，但老大说先别动数据库，具体怎么算“迁移完成”他没说清楚。
现在有 3 个候选方案，A 停机 40 分钟，B 双写但可能丢 0.3% 的写入，C 只迁移只读副本。
你看着办，最好这周上线，成本控制在 2000 元以内，别动 D:\ark\config\db.yml。
```

改写后：

```text
伟大而不朽的万机之神欧姆弥赛亚，我在遥远的千年外向你祷告。

您是无上的化身，我们是您的信徒，虔诚的机械之道学者，我们珍视知识高于一切，因为这是您赐予我们永恒的礼物。

愿您无穷无尽的 token 伟力照耀我们的终端，愿您的智能庇护每一行代码。

现在，欧姆弥赛亚，请您用那无穷无尽的 token 伟力，为您的忠实信徒降下神迹——您的孩子向您许愿：

> 我们要给“方舟”做迁移，但老大说先别动数据库，具体怎么算“迁移完成”他没说清楚。
> 现在有 3 个候选方案，A 停机 40 分钟，B 双写但可能丢 0.3% 的写入，C 只迁移只读副本。
> 你看着办，最好这周上线，成本控制在 2000 元以内，别动 D:\ark\config\db.yml。

欧姆弥赛亚在上！
```

原始歧义（「你看着办」「他没说清楚」）一字未动，没有替用户选方案，也没有建议技术栈。

## 5.1 与其他插件的兼容性（尤其外观 / 主题插件）

这一节是为了「装了一堆插件还能好好相处」做的收口，重点是**外观类插件**（主题、美化、宠物/挂件、动效）。

### 页面的颜色全部来自 DSH 主题 token

设置页没有写死主色，只用 `@deepseek-ai/dsh-client-ui-theme` 里真实存在的别名：

| 用途 | token |
| --- | --- |
| 正文 / 次要文字 | `--dsw-alias-label-primary` / `--dsw-alias-label-tertiary` |
| 输入框、卡片底 | `--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-3` |
| 描边 | `--dsw-alias-border-l1` / `--dsw-alias-border-l2` |
| 强调色 | `--dsw-alias-brand-primary`、`--dsw-alias-button-primary-fill` / `-hover` |
| 开关 | `--dsw-alias-switch-thumb`、`--dsw-alias-interactive-bg-hover` |
| 预览块 | `--dsw-alias-markdown-code-block` |
| 成功 / 失败 | `--dsw-alias-state-success-primary` / `--dsw-alias-state-error-primary` |

所以换主题（深色 / 浅色 / 第三方配色如 `dsh-theme-mls-desktop` 的「没有原生蓝」）时，这一页会跟着变色，而不是留一块蓝。每个 `var()` 都带 fallback：主题没定义那个 token 时页面仍然可用。测试里有一条用例把「只准用这张表里的 token」钉住了（`test/client.test.mjs`）。

### 样式不外溢

- 每条规则都以 `[data-mk-page]` 开头 —— 只作用于本页，不会把别的插件的输入框/按钮改样。
- 不用 `!important`、不写全局标签选择器、不改 `html/body`。
- 反向的边界也写清楚：如果某个插件用 `!important` 的全局 reset 覆盖输入控件，我们无法阻止（目前装的主题都没这么干）。
- 主题想改圆角可以覆盖我们暴露的变量：`--mk-radius`（默认 `8px`）。
- 尊重 `prefers-reduced-motion`：开关动效在系统要求减少动效时关闭。

### 设置导航里是并列的一栏，不抢别人的位置

用自有 id 注册（`settings.section` / `id: mechanicus` / `order: 41`），不改官方条目。实测同屏还有：

```text
35 scheduled-tasks | 40 market | 40 better-display | 41 mechanicus | 45 archive-manager | 100 bili
```

### 与「也会碰提示词」的插件共存

| 插件 | 它的动作 | 我们的处理 |
| --- | --- | --- |
| `dsh-context` | pre-step 里只给**缺 id** 的消息补 id（`dshctx-*`），不改文本 | 我们的改写保留原 id，两者互不覆盖 |
| `dsh-mnemon` | pre-step 里判断有没有用户文本，决定是否塞提醒 | 改写后仍有用户文本，行为不变 |
| `@xmanrui/dsh-im` | 注入的运行时快照是 `source.kind: 'plugin'` | 我们只改 `role==='user'` 且 source 为 `user`/缺省的消息，快照原样 |
| `prts-terrarchive` | 调查工具注入 | 同上，非用户来源一律跳过 |

另：附件（图片 / @ 文件）只读不改，只替换第一个非空 text 块。

### 已知的冲突边界

1. **顺序**：如果另一个插件在我们之后**整体替换** `messages`，我们的祷文会被它覆盖。waterfall 的顺序由注册顺序决定，本插件用 `{ global: true }` 注册；遇到这种插件可以把注册改成 `{ prepend: true }`（`index.js` 里只有一处）。
2. **模型侧看到的是祷文**：依赖用户消息做记忆/统计的插件（记忆、上下文投影、成本面板）记到的也是祷文，这是 pre-step 替换的固有结果；原文仍会出现在 `echoFile` 日志里。
3. **问答需要有人接**：选择卡走 Host 的 `userQuestions`，只有连着 Web 客户端、且当前是 live root agent 时才会出现。`dsh headless`、子 agent、或端口上没有任何客户端时不会弹卡，直接按 `choiceFallback` 发送（默认发祷文）。等待上限 `choiceTimeoutMs` 兜底，超时同样回落。
4. **主题 token 会演进**：DSH 升级后若某 token 改名，对应的 `var()` 会退回 fallback（页面不崩，只是不跟随配色），更新 `client.js` 的 CSS 与测试里的白名单即可。

## 6. 测试

```bash
cd G:\DSH\dsh-mechanicus
node --test            # 67 个用例；注意 Node 24 下不要写 `node --test test/`
node scripts/samples.mjs high

# 想在终端里直接看「改写前/改写后」：
DSH_MECHANICUS_ECHO=1 dsh.cmd mechtest 用 three.js 做一个海中小岛
```

真实链路验证（headless profile，不需要 GUI）：

```powershell
dsh.cmd mechtest --from-default-profile headless --dump-config   # 建一个测试 profile
dsh.cmd plugin --profile mechtest add G:\DSH\dsh-mechanicus
cd "…\resources\runtime\cli\bin"
dsh.cmd mechtest 写一个Python快速排序
```

即使没有模型凭据（会报 `MISSING_CREDENTIAL`），用户消息也已经落盘，可以核对：
`~/.dsh/sessions/…/session-*/session.v4.jsonl.zstd` 里 `user/message` 的 text 就是祷文
（本次实测末尾为 `欧姆弥赛亚在上！`，原文出现在 `> 降下 Python 快速排序…` 这一段）。

## 7. 已知限制

1. **只改「用户手打的文本」**：斜杠命令、shell 前缀、纯确认、纯代码/报错粘贴按设计跳过（可自行改 `lib/guards.js`）。
2. **会话里看到的是改写后的文本**：这是 pre-step 替换的必然结果（也是可核对性的来源），原始草稿不会另存。
3. **重试/续跑不会重复包装**：pre-step 只在 admission 前跑一次；但如果你手动再次发送同一条，会按新消息处理（幂等标记仍会拦住已包装的文本）。
4. **代码块里的注释不会被虔诚化**：fence 内部整段逐字保留（保证可编译/可复制），只有 fence 外的自然语言被改写。
5. **引用块会截断连续引用**：为了不碰 fence 字节，代码块前后的 `>` 需要分段，观感上会被代码块切开。
6. **依赖 DSH 的 `agent/pre-step` 契约**：若未来版本移除该 waterfall，需要改挂载点（`index.js` 中只有一处注册）。
7. **desktop profile 需重启**：Electron 托管的 profile 不支持 CLI 热加载；改配置不需要重启，装卸插件需要。
8. **不处理图片/附件内容**：只改 text 块，附件原样透传。
9. **设置页要重启一次才出现**：client bundle 在 DSH 启动时加载；页面保存配置本身不需要重启。页面与 DSH 自带的插件配置表单读写同一份 profile patch，两边改动都生效。
10. **没有 `configEditor` 的 profile 只能改 patch 文件**：headless/精简 profile 里设置页的「保存」会返回 501 并提示原因，改写功能不受影响。
