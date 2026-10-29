import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BandInfo, Quota } from '../types'

const info = atom({ plugin: 'status-band', key: 'info' } as const, null)

const WINDOWS: Record<string, number> = { five_hour: 18000, seven_day: 604800 }
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

const modelName = (id: string) => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id)
  if (!m) return id
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`
}

const duration = (secs: number) => {
  const mins = Math.floor(Math.max(secs, 0) / 60)
  if (mins >= 1440) {
    const d = Math.floor(mins / 1440)
    const h = Math.floor((mins % 1440) / 60)
    return h === 0 ? `${d}d` : `${d}d${h}h`
  }
  if (mins >= 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m === 0 ? `${h}h` : `${h}h${m}m`
  }
  return `${mins}m`
}

// Windows paths: compare and show with forward slashes, ignoring drive-letter case
const slashes = (p: string) => p.replace(/\\/g, '/')
const underHome = (path: string, home: string) => {
  const p = slashes(path)
  const h = slashes(home).replace(/\/+$/, '')
  if (!h) return p
  const win = /^[a-z]:/i.test(h)
  const [pc, hc] = win ? [p.toLowerCase(), h.toLowerCase()] : [p, h]
  return pc === hc || pc.startsWith(`${hc}/`) ? `~${p.slice(h.length)}` : p
}

let effort: string | undefined
let who = ''

async function hostName($: any) {
  // hostname -s fails on Windows, where COMPUTERNAME is set instead
  const computer = await $.env.get('COMPUTERNAME')
  if (computer) return computer
  try {
    const r = await $.process.run(['hostname', '-s'])
    if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim()
  } catch {}
  try {
    return (await $.process.run(['hostname'])).stdout.trim().split('.')[0]
  } catch {
    return ''
  }
}

async function refresh($: any, git = true) {
  if (!who) {
    try {
      const user = (await $.env.get('USER')) || (await $.env.get('USERNAME')) || ''
      const host = await hostName($)
      who = user || host ? `${user}${user && host ? '@' : ''}${host}:` : ''
    } catch {
      who = ''
    }
  }
  const usage = await $.session.usage()
  const prev: BandInfo | null = await read($, info)
  let cwd = prev?.cwd ?? ''
  let branch = prev?.branch ?? ''
  let dirty = prev?.dirty ?? false

  if (git || prev === null) {
    // project root: unlike cwd, a shell cd during the session doesn't move it
    cwd = await $.session.root()
    try {
      // show the repo root rather than a deep working directory
      const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
      if (top.exitCode === 0 && top.stdout.trim()) cwd = top.stdout.trim()
      const b = await $.process.run(['git', 'branch', '--show-current'], { cwd })
      branch = b.exitCode === 0 ? b.stdout.trim() : ''
      if (branch) {
        const s = await $.process.run(['git', 'status', '--porcelain'], { cwd })
        dirty = s.exitCode === 0 && s.stdout.trim().length > 0
      } else dirty = false
    } catch {
      branch = ''
      dirty = false
    }
  }

  const quotas: Quota[] = usage.rateLimits
    .filter((r: any) => r.kind in WINDOWS)
    .map((r: any) => ({
      kind: r.kind,
      percentUsed: r.percentUsed,
      resetsAt: r.resetsAt ? Math.floor(Date.parse(r.resetsAt) / 1000) : undefined,
    }))

  const next: BandInfo = {
    cwd,
    branch,
    dirty,
    model: modelName(await $.session.model()),
    // keep the last level seen across reloads; CLAUDE_EFFORT before the first turn
    effort: effort ?? prev?.effort ?? (await $.env.get('CLAUDE_EFFORT')) ?? undefined,
    ctx: usage.context.percent,
    quotas,
  }
  await update($, info, () => next)
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    refresh($).catch(() => {})
    // keeps "time left" ticking between turns
    $.clock.every(60000, () => refresh($, false).catch(() => {}))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== effort) {
      effort = typeof e.effort === 'number' ? String(e.effort) : e.effort
      refresh($, false).catch(() => {})
    }
    return yield* next(e)
  })

  on('turn.complete', ($, e, next) => {
    refresh($).catch(() => {})
    return next(e)
  })

  on('session.measure', ($, e, next) => {
    refresh($, false).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // the terminal CLI already has a status line; only draw the band on desktop
    if (e.surface !== 'desktop') return next(e)
    const data: BandInfo | null = await read($, info)
    if (e.props.hasSurvey || data === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = Math.floor((await $.clock.now()) / 1000)
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
    const cwd = underHome(data.cwd, home)

    const quota = (q: Quota) => {
      const window = WINDOWS[q.kind]
      const pct = Math.round(q.percentUsed)
      const left = q.resetsAt === undefined
        ? Math.round((1 - q.percentUsed / 100) * window)
        : Math.min(Math.max(q.resetsAt - now, 0), window)
      const hasReset = q.resetsAt !== undefined
      const expected = Math.round(((window - left) / window) * 100)
      const healthy = q.percentUsed <= expected
      const color = hasReset ? (healthy ? 'green' : 'red')
        : 100 - q.percentUsed > 50 ? 'green' : 100 - q.percentUsed >= 25 ? 'yellow' : 'red'
      return { q, pct, left, color, hasReset, expected, healthy }
    }

    const quotas = data.quotas
      .slice()
      .sort((a, b) => (a.kind === 'five_hour' ? -1 : b.kind === 'five_hour' ? 1 : 0))
      .map(quota)

    const level = data.effort ? data.effort.charAt(0).toUpperCase() + data.effort.slice(1) : ''

    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Text>
            <Text color="green" bold>{who}</Text>
            <Text color="blue" bold>{cwd}</Text>
          </Text>
          <Text>
            {data.ctx !== undefined ? <Text color="cyan">{`ctx:${Math.round(data.ctx)}%`}</Text> : null}
            {quotas.map((x, i) => (
              <Text key={x.q.kind}>
                <Text>{i === 0 ? (data.ctx === undefined ? '' : ' ') : ' / '}</Text>
                <Text>{`${LABELS[x.q.kind]}: `}</Text>
                <Text color={x.color}>{`${x.pct}% ${duration(x.left)}`}</Text>
                {x.hasReset
                  ? <Text color={x.color}>{x.healthy ? ` (♥ ${x.expected}%)` : ` (⚠ ${x.expected}%)`}</Text>
                  : null}
              </Text>
            ))}
          </Text>
        </Box>
        <Box width="100%">
          <Text>
            {data.branch ? <Text color="magenta">{`(${data.branch}${data.dirty ? '*' : ''}) `}</Text> : null}
            <Text color="yellow">{`[${data.model}${level ? `/${level}` : ''}]`}</Text>
          </Text>
        </Box>
      </Box>
    )
  })
}
