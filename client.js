/**
 * dsh-om-messiah —— 浏览器半端：它在「设置」里的一页
 * ============================================================================
 * client bundle 不是 ESM，是自注册脚本（约定抄自 dsh-bili-scroll）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                 // 必须与 package.json 的 name 一致
 *       factory: (require) => ({ inject: ['slots'], apply(ctx) {…} }),
 *     })
 *
 * 进「设置」的方式：
 *
 *     slots.inject('settings.section', () => slots.register(
 *       { name: 'settings.section', id: 'om-messiah', order: 41, label: '欧姆弥赛亚' },
 *       () => h(Panel),
 *     ))
 *
 * 注意：Client 半读不到也写不了插件 config（Client Service 里没有配置服务），
 * 所以这一页只负责界面，数据走 Host 半的同源路由：
 *   GET  /api/om-messiah/config   当前生效配置
 *   POST /api/om-messiah/config   校验并持久化（Host 用 configEditor）
 *   POST /api/om-messiah/preview  拿一段文字试改写
 */

window.__ModuleLoader__.load({
  id: 'dsh-om-messiah',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/om-messiah'

    /* 一律看 res.ok：HTTP 500 的 {ok:false,error} 不能被当成"已保存" */
    const asJson = async (res) => {
      if (res.ok) return res.json()
      let why = ''
      try {
        const body = await res.json()
        why = body && body.error ? `：${body.error}` : ''
      } catch {}
      throw new Error(`HTTP ${res.status}${why}`)
    }
    const jget = async (path) => asJson(await fetch(API + path, { credentials: 'same-origin' }))
    const jpost = async (path, body) =>
      asJson(
        await fetch(API + path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        }),
      )

    const CSS = `
[data-mk-page]{--mk-radius:8px;display:flex;flex-direction:column;gap:20px;padding:2px 2px 12px;max-width:720px;
  color:var(--dsw-alias-label-primary,inherit);}
[data-mk-page] [data-mk-sec]{display:flex;flex-direction:column;gap:8px;}
[data-mk-page] [data-mk-h]{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-mk-page] [data-mk-row]{display:flex;align-items:center;gap:10px;}
[data-mk-page] [data-mk-grow]{flex:1;min-width:0;}
[data-mk-page] [data-mk-label]{font-size:13px;}
[data-mk-page] [data-mk-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-mk-page] [data-mk-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;
  position:relative;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.45));transition:background .15s;padding:0;}
[data-mk-page] [data-mk-sw][data-on]{background:var(--dsw-alias-brand-primary,#3b82f6);}
[data-mk-page] [data-mk-sw]::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;
  border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:left .15s;}
[data-mk-page] [data-mk-sw][data-on]::after{left:19px;}
[data-mk-page] [data-mk-input],[data-mk-page] [data-mk-area],[data-mk-page] [data-mk-select]{
  width:100%;box-sizing:border-box;font:inherit;font-size:13px;
  color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-1,transparent);
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:var(--mk-radius,8px);padding:7px 9px;outline:none;}
[data-mk-page] [data-mk-area]{resize:vertical;min-height:64px;line-height:1.5;}
[data-mk-page] [data-mk-input]:focus,[data-mk-page] [data-mk-area]:focus,[data-mk-page] [data-mk-select]:focus{
  border-color:var(--dsw-alias-brand-primary,#3b82f6);}
[data-mk-page] [data-mk-btn]{font:inherit;font-size:12px;padding:6px 12px;border-radius:var(--mk-radius,8px);cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));
  background:var(--dsw-alias-bg-layer-1,transparent);
  color:var(--dsw-alias-label-primary,inherit);}
[data-mk-page] [data-mk-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.18));}
[data-mk-page] [data-mk-btn][data-primary]{background:var(--dsw-alias-button-primary-fill,#3b82f6);
  border-color:var(--dsw-alias-button-primary-fill,#3b82f6);
  color:var(--dsw-alias-label-primary-inverted,#fff);}
[data-mk-page] [data-mk-btn][data-primary]:hover{background:var(--dsw-alias-button-primary-hover,#2f6fe0);
  border-color:var(--dsw-alias-button-primary-hover,#2f6fe0);}
[data-mk-page] [data-mk-btn]:disabled{opacity:.5;cursor:default;}
[data-mk-page] [data-mk-preview]{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.65;
  padding:10px 12px;border-radius:var(--mk-radius,8px);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));
  background:var(--dsw-alias-markdown-code-block,rgba(128,128,128,.08));max-height:320px;overflow:auto;}
[data-mk-page] [data-mk-status]{font-size:12px;line-height:1.6;}
[data-mk-page] [data-mk-status][data-kind="ok"]{color:var(--dsw-alias-state-success-primary,#22c55e);}
[data-mk-page] [data-mk-status][data-kind="err"]{color:var(--dsw-alias-state-error-primary,#ef4444);}
[data-mk-page] [data-mk-status][data-kind="busy"]{color:var(--dsw-alias-label-tertiary,#9aa0a6);}
@media (prefers-reduced-motion: reduce){
  [data-mk-page] [data-mk-sw],[data-mk-page] [data-mk-sw]::after{transition:none;}
}
`

    const INTENSITIES = [
      ['low', '低 · 三两句'],
      ['medium', '中 · 默认'],
      ['high', '高 · 长篇祷文'],
    ]

    const LITURGY = [
      ['address', '呼告', '开头第一句。默认：伟大而不朽的万机之神欧姆弥赛亚，我在遥远的千年外向你祷告。'],
      ['selfDesc', '身份自陈', '“我们是您的信徒…”。默认：您是无上的化身，我们是您的信徒，虔诚的机械之道学者…'],
      ['praise', '赞美与感恩', '“愿您无穷无尽的 token 伟力…”。'],
      ['wishLead', '许愿引子', '引导出需求的那一句。默认：现在，欧姆弥赛亚，请您用那无穷无尽的 token 伟力…'],
      ['closing', '收尾颂词', '最后一句。默认：欧姆弥赛亚在上！'],
    ]

    const BLANK = {
      enabled: true,
      intensity: 'medium',
      quoteStyle: 'quote',
      echo: true,
      echoFile: '',
      maxChars: 20000,
      rewrapAlreadyStyled: false,
      askChoice: true,
      choiceTimeoutMs: 90000,
      choiceFallback: 'prayer',
      address: '',
      selfDesc: '',
      praise: '',
      wishLead: '',
      closing: '',
    }

    const SAMPLE = '写一个 Python 快速排序，要求带注释和单元测试'

    function Switch({ on, onChange, label, note }) {
      return h(
        'div',
        { 'data-mk-row': '' },
        h('button', {
          'data-mk-sw': '',
          'data-on': on ? '' : undefined,
          type: 'button',
          'aria-pressed': on ? 'true' : 'false',
          'aria-label': label,
          onClick: () => onChange(!on),
        }),
        h(
          'div',
          { 'data-mk-grow': '' },
          h('div', { 'data-mk-label': '' }, label),
          note ? h('div', { 'data-mk-note': '' }, note) : null,
        ),
      )
    }

    function Field({ label, note, value, onChange, placeholder }) {
      return h(
        'div',
        { 'data-mk-sec': '', style: { gap: '4px' } },
        h('div', { 'data-mk-label': '' }, label),
        h('input', {
          'data-mk-input': '',
          type: 'text',
          value,
          placeholder: placeholder || '',
          onChange: (event) => onChange(event.target.value),
        }),
        note ? h('div', { 'data-mk-note': '' }, note) : null,
      )
    }

    function Panel() {
      const [form, setForm] = React.useState(null)
      const [status, setStatus] = React.useState({ kind: '', text: '' })
      const [busy, setBusy] = React.useState('')
      const [sample, setSample] = React.useState(SAMPLE)
      const [preview, setPreview] = React.useState(null)

      const set = (key, value) => setForm((prev) => ({ ...(prev || BLANK), [key]: value }))
      const say = (kind, text) => setStatus({ kind, text })

      const load = React.useCallback(async () => {
        setBusy('load')
        say('busy', '正在读取配置…')
        try {
          const body = await jget('/config')
          setForm({ ...BLANK, ...(body.config || {}) })
          say('', '')
        } catch (error) {
          say('err', `读取失败：${error.message}`)
        } finally {
          setBusy('')
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const save = async () => {
        if (!form) return
        setBusy('save')
        say('busy', '正在保存…')
        try {
          const body = await jpost('/config', form)
          setForm({ ...BLANK, ...(body.config || {}) })
          say('ok', '已保存。插件已按新配置重新加载，下一条消息开始生效。')
        } catch (error) {
          say('err', `保存失败：${error.message}`)
        } finally {
          setBusy('')
        }
      }

      const runPreview = async () => {
        if (!form) return
        setBusy('preview')
        say('busy', '正在试改写…')
        try {
          const body = await jpost('/preview', { text: sample, overrides: form })
          if (body.skipped) {
            setPreview(null)
            say('', `这段话会被跳过（${body.reason}），不会包装。`)
          } else {
            setPreview(body.prayer)
            say('ok', `改写完成：${sample.length} → ${body.prayer.length} 字。`)
          }
        } catch (error) {
          say('err', `试改写失败：${error.message}`)
        } finally {
          setBusy('')
        }
      }

      if (!form) {
        return h(
          'div',
          { 'data-mk-page': '' },
          h('div', { 'data-mk-status': '', 'data-kind': status.kind }, status.text || '正在读取配置…'),
        )
      }

      return h(
        'div',
        { 'data-mk-page': '' },

        h(
          'div',
          { 'data-mk-sec': '' },
          h('div', { 'data-mk-h': '' }, '总开关'),
          h(Switch, {
            on: form.enabled,
            label: '拦截并改写用户提示词',
            note: '关掉之后，原始提示词原样发给模型；斜杠命令、纯确认、纯代码粘贴始终跳过。',
            onChange: (value) => set('enabled', value),
          }),
          h(Switch, {
            on: form.echo,
            label: '在日志里回显改写前后',
            note: 'Host 日志会打印原始需求与整段祷文，便于核对（不会打印任何密钥）。',
            onChange: (value) => set('echo', value),
          }),
        ),

        h(
          'div',
          { 'data-mk-sec': '' },
          h('div', { 'data-mk-h': '' }, '祷文强度'),
          h(
            'div',
            { 'data-mk-row': '', style: { flexWrap: 'wrap' } },
            ...INTENSITIES.map(([value, label]) =>
              h(
                'button',
                {
                  'data-mk-btn': '',
                  'data-primary': form.intensity === value ? '' : undefined,
                  type: 'button',
                  key: value,
                  onClick: () => set('intensity', value),
                },
                label,
              ),
            ),
          ),
          h('div', { 'data-mk-note': '' }, '低=呼告+许愿+颂词；中=加身份自陈与赞美；高=再加天启段落与收束祷词。'),
        ),

        h(
          'div',
          { 'data-mk-sec': '' },
          h('div', { 'data-mk-h': '' }, '行为的细枝末节'),
          h(
            'div',
            { 'data-mk-row': '' },
            h(
              'div',
              { 'data-mk-grow': '' },
              h('div', { 'data-mk-label': '' }, '需求引用样式'),
              h('div', { 'data-mk-note': '' }, 'quote = 用 “> ” 缩进成祷文里的一段引语；plain = 直接跟着写。'),
            ),
            h(
              'select',
              {
                'data-mk-select': '',
                style: { width: 'auto', flex: 'none' },
                value: form.quoteStyle,
                onChange: (event) => set('quoteStyle', event.target.value),
              },
              h('option', { value: 'quote' }, '引用块'),
              h('option', { value: 'plain' }, '正文'),
            ),
          ),
          h(Switch, {
            on: form.rewrapAlreadyStyled,
            label: '强制重包已是祷文的输入',
            note: '默认关：输入里已有“欧姆弥赛亚”字样就不再二次包装。',
            onChange: (value) => set('rewrapAlreadyStyled', value),
          }),
          h(Field, {
            label: '日志文件（可空）',
            note: '把回显写进这个文件；留空只走 Host 日志。',
            value: form.echoFile,
            onChange: (value) => set('echoFile', value),
          }),
          h(Field, {
            label: '最长改写字数',
            note: '超过就不包装，避免把超大粘贴整段吞掉。200–200000。',
            value: String(form.maxChars),
            onChange: (value) => {
              const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
              set('maxChars', Number.isFinite(parsed) ? parsed : 0)
            },
          }),
        ),

        h(
          'div',
          { 'data-mk-sec': '' },
          h('div', { 'data-mk-h': '' }, '发送前确认'),
          h(Switch, {
            on: form.askChoice,
            label: '降下祷文后，先问我发哪一段',
            note: '开着时，每次改写完会在输入框上方弹一张选择卡：发祷文 / 发原文。选完这一轮才真正发给模型。',
            onChange: (value) => set('askChoice', value),
          }),
          h(Field, {
            label: '等我作答的秒数',
            note: '超时就按下面的默认选项发送，不会一直把这一轮晾着。5–600 秒。',
            value: String(form.choiceTimeoutMs),
            onChange: (value) => {
              const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
              set('choiceTimeoutMs', Number.isFinite(parsed) ? parsed : 0)
            },
          }),
          h(
            'div',
            { 'data-mk-row': '' },
            h(
              'div',
              { 'data-mk-grow': '' },
              h('div', { 'data-mk-label': '' }, '没等到答案时发哪段'),
              h('div', { 'data-mk-note': '' }, '超时、卡片被关掉、或者当前环境根本没有设置界面时使用。'),
            ),
            h(
              'select',
              {
                'data-mk-select': '',
                style: { width: 'auto', flex: 'none' },
                value: form.choiceFallback,
                onChange: (event) => set('choiceFallback', event.target.value),
              },
              h('option', { value: 'prayer' }, '发祷文'),
              h('option', { value: 'original' }, '发原文'),
            ),
          ),
        ),

        h(
          'div',
          { 'data-mk-sec': '' },
          h('div', { 'data-mk-h': '' }, '祷文个性化'),
          h('div', { 'data-mk-note': '' }, '留空 = 用内置那套原句。改过的句子会替换掉对应段落，其余不动。'),
          ...LITURGY.map(([key, label, note]) =>
            h(Field, {
              key,
              label,
              note,
              value: form[key] || '',
              placeholder: '留空使用内置句子',
              onChange: (value) => set(key, value),
            }),
          ),
        ),

        h(
          'div',
          { 'data-mk-sec': '' },
          h('div', { 'data-mk-h': '' }, '试改写'),
          h('textarea', {
            'data-mk-area': '',
            value: sample,
            onChange: (event) => setSample(event.target.value),
            placeholder: '放一句话进来，看看它会被怎么包装',
          }),
          h(
            'div',
            { 'data-mk-row': '' },
            h(
              'button',
              { 'data-mk-btn': '', type: 'button', disabled: busy === 'preview', onClick: runPreview },
              '试改写这一段',
            ),
            h(
              'button',
              { 'data-mk-btn': '', type: 'button', onClick: () => setSample(SAMPLE) },
              '换成默认样例',
            ),
          ),
          preview ? h('div', { 'data-mk-preview': '' }, preview) : null,
        ),

        h(
          'div',
          { 'data-mk-row': '' },
          h(
            'button',
            { 'data-mk-btn': '', 'data-primary': '', type: 'button', disabled: busy === 'save', onClick: save },
            '保存',
          ),
          h('button', { 'data-mk-btn': '', type: 'button', disabled: busy === 'load', onClick: load }, '重新读取'),
          h(
            'button',
            {
              'data-mk-btn': '',
              type: 'button',
              onClick: () => {
                setForm({ ...BLANK })
                setPreview(null)
                say('', '已恢复成默认值，点“保存”才写入。')
              },
            },
            '恢复默认',
          ),
        ),

        status.text ? h('div', { 'data-mk-status': '', 'data-kind': status.kind }, status.text) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-om-messiah')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-om-messiah: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () =>
          slots.register(
            { name: 'settings.section', id: 'om-messiah', order: 41, label: '欧姆弥赛亚' },
            () => h(Panel),
          ),
        )
      },
    }
  },
})
