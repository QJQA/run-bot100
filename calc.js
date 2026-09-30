// calc.js — 纯计算，不碰 DOM。网页和之后的 Skill 共用同一套口径。
(function (root) {
  'use strict'

  // ---------------------------------------------------------------- 时间格式

  const pad2 = n => String(n).padStart(2, '0')

  // "6:30" → 390；无效返回 NaN
  function parsePace (str) {
    const m = String(str || '').trim().match(/^(\d{1,2})[:：'′](\d{1,2})$/)
    if (!m || +m[2] >= 60) return NaN
    return +m[1] * 60 + +m[2]
  }

  // 390 → "6:30"
  function fmtPace (sec) {
    if (!isFinite(sec) || sec <= 0) return '--:--'
    let s = Math.round(sec)
    return `${Math.floor(s / 60)}:${pad2(s % 60)}`
  }

  // 3725 → "1:02:05"；不足 1 小时 → "45:10"
  function fmtDuration (sec) {
    if (!isFinite(sec) || sec <= 0) return '--:--'
    const s = Math.round(sec)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`
  }

  // ---------------------------------------------------------------- 配速

  const RACES = [
    { key: '5k', name: '5 公里', km: 5 },
    { key: '10k', name: '10 公里', km: 10 },
    { key: 'half', name: '半程马拉松', km: 21.0975 },
    { key: 'full', name: '全程马拉松', km: 42.195 }
  ]

  // 把总距离按 stepKm 切段，前慢后快：每段比上一段快 progSec 秒/公里，总用时仍等于目标。
  function splits (km, totalSec, stepKm, progSec) {
    const segs = []
    let left = km
    while (left > 0.001) {
      const d = Math.min(stepKm, left)
      segs.push(d)
      left -= d
    }
    const weighted = segs.reduce((a, d, i) => a + i * progSec * d, 0)
    const base = (totalSec + weighted) / km
    let cum = 0
    return segs.map((d, i) => {
      cum += d
      const pace = base - i * progSec
      return { no: i + 1, km: d, cumKm: cum, pace, sec: pace * d }
    })
  }

  // Riegel 公式：T2 = T1 × (D2 / D1)^1.06。距离差得越远越不准，只作参考。
  function riegel (km1, sec1, km2) {
    return sec1 * Math.pow(km2 / km1, 1.06)
  }

  // ---------------------------------------------------------------- 心率

  // Tanaka 公式：208 − 0.7 × 年龄
  function maxHrByAge (age) {
    return Math.round(208 - 0.7 * age)
  }

  // 丹尼尔斯训练强度，按储备心率（Karvonen）百分比。R（重复跑）按配速控制，不看心率。
  const DANIELS_ZONES = [
    { key: 'E', name: '轻松跑', lo: 0.59, hi: 0.74, feel: '能完整说话，一点不喘', use: '日常大多数跑步、热身、放松、长距离' },
    { key: 'M', name: '马拉松配速跑', lo: 0.74, hi: 0.84, feel: '能说短句', use: '马拉松目标配速练习' },
    { key: 'T', name: '乳酸阈值跑', lo: 0.84, hi: 0.88, feel: '"舒服的吃力"，只能蹦几个词', use: '节奏跑、巡航间歇，提升耐力上限' },
    { key: 'I', name: '间歇跑', lo: 0.95, hi: 1.0, feel: '很吃力，说不了话', use: '3–5 分钟快跑间歇，提升最大摄氧量' }
  ]

  function hrZones (restHr, maxHr) {
    const hrr = maxHr - restHr
    return DANIELS_ZONES.map(z => ({
      ...z,
      bpmLo: Math.round(restHr + hrr * z.lo),
      bpmHi: Math.round(restHr + hrr * z.hi)
    }))
  }

  // ---------------------------------------------------------------- 训练日志

  const TYPES = {
    easy: '轻松跑',
    base: '基础跑',
    long: '长距离',
    interval: '间歇',
    race: '比赛/测试',
    rest: '休息日'
  }

  // 'YYYY-MM-DD' → 本地日期（避免 new Date('2026-01-01') 被当成 UTC）
  function parseDate (str) {
    const [y, m, d] = str.split('-').map(Number)
    return new Date(y, m - 1, d)
  }

  function ymd (date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  // 该日期所在周的周一
  function weekStart (str) {
    const d = parseDate(str)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return ymd(d)
  }

  function addDays (str, n) {
    const d = parseDate(str)
    d.setDate(d.getDate() + n)
    return ymd(d)
  }

  // 一次训练的负荷 = 时长(分钟) × RPE（Foster 的 session-RPE 法）
  function sessionLoad (r) {
    return (r.min || 0) * (r.rpe || 0)
  }

  // 按周汇总：从第一条记录所在周到 today 所在周，空周也列出（负荷为 0，ACWR 需要它）。
  function weeklySummary (records, today) {
    const runs = records.filter(r => r.type !== 'rest' && (r.km || r.min))
    if (!runs.length) return []
    const first = weekStart(runs.map(r => r.date).sort()[0])
    const last = weekStart(today)
    const weeks = []
    for (let w = first; w <= last; w = addDays(w, 7)) {
      const end = addDays(w, 6)
      const rs = runs.filter(r => r.date >= w && r.date <= end)
      const rpes = rs.filter(r => r.rpe).map(r => r.rpe)
      weeks.push({
        week: w,
        km: rs.reduce((a, r) => a + (r.km || 0), 0),
        min: rs.reduce((a, r) => a + (r.min || 0), 0),
        load: rs.reduce((a, r) => a + sessionLoad(r), 0),
        runs: rs.length,
        avgRpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null
      })
    }
    weeks.forEach((wk, i) => {
      const prev = weeks[i - 1]
      wk.kmChange = prev && prev.km > 0 ? (wk.km - prev.km) / prev.km : null
      // ACWR = 本周负荷 ÷ 前 4 周平均负荷；前面不满 4 周时不算
      if (i >= 4) {
        const chronic = weeks.slice(i - 4, i).reduce((a, x) => a + x.load, 0) / 4
        wk.acwr = chronic > 0 ? wk.load / chronic : null
      } else {
        wk.acwr = null
      }
    })
    return weeks
  }

  function median (arr) {
    const s = [...arr].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }

  // 晨起静息心率基线：最新一次之前 28 天内的中位数（至少 3 个值）
  function restHrStatus (records) {
    const hr = records.filter(r => r.restHr).sort((a, b) => a.date < b.date ? -1 : 1)
    if (hr.length < 4) return null
    const latest = hr[hr.length - 1]
    const from = addDays(latest.date, -28)
    const prev = hr.filter(r => r.date >= from && r.date < latest.date).map(r => r.restHr)
    if (prev.length < 3) return null
    const base = median(prev)
    return { date: latest.date, value: latest.restHr, baseline: base, diff: latest.restHr - base }
  }

  // 生成提醒：level = danger / warn / info / ok
  function alerts (records, today) {
    const out = []
    const weeks = weeklySummary(records, today)
    const cur = weeks[weeks.length - 1]
    const last = weeks[weeks.length - 2]

    // 1) 周跑量涨幅：比较"上一个完整周"和它的前一周，本周还没跑完不算
    if (last && last.kmChange != null && last.kmChange > 0.1 && last.km >= 5) {
      out.push({
        level: last.kmChange > 0.3 ? 'danger' : 'warn',
        title: `上周跑量比前一周多了 ${Math.round(last.kmChange * 100)}%`,
        detail: '新手每周跑量涨幅尽量别超过 10%。骨骼、肌腱适应得比心肺慢，涨太快是最常见的受伤原因。这周可以持平或少跑一点。'
      })
    }
    if (cur && last && last.km > 0 && cur.km > last.km * 1.1 && cur.km >= 5) {
      out.push({
        level: 'warn',
        title: `本周已跑 ${cur.km.toFixed(1)} 公里，超过上周的 110%`,
        detail: `上周 ${last.km.toFixed(1)} 公里。本周剩下的训练建议以轻松跑为主，或者休息。`
      })
    }

    // 2) ACWR：本周没跑完时数值天然偏低，所以本周已超标才看本周，否则看上一个完整周
    const acwrWeek = cur && cur.acwr > 1.3 ? cur : (last && last.acwr != null ? last : null)
    if (acwrWeek) {
      const a = acwrWeek.acwr
      const label = acwrWeek === cur ? '本周' : '上周'
      if (a > 1.5) {
        out.push({ level: 'danger', title: `${label}负荷是前 4 周平均的 ${a.toFixed(2)} 倍`, detail: '训练量一下子加得太多。建议接下来几天减量、以轻松跑为主。' })
      } else if (a > 1.3) {
        out.push({ level: 'warn', title: `${label}负荷是前 4 周平均的 ${a.toFixed(2)} 倍`, detail: '加量偏快，先稳住，别再往上加。' })
      }
    }

    // 3) 静息心率
    const hr = restHrStatus(records)
    if (hr && hr.date >= addDays(today, -2) && hr.diff >= 5) {
      out.push({
        level: hr.diff >= 10 ? 'danger' : 'warn',
        title: `晨起心率 ${hr.value}，比平时高 ${Math.round(hr.diff)}`,
        detail: `你近 4 周的晨起心率中位数是 ${Math.round(hr.baseline)}。升高 5 以上常见于没恢复好、睡眠差、压力大或快生病了。今天建议休息或只慢跑。`
      })
    }

    // 4) 睡眠、疲劳
    const recent = records.filter(r => r.date >= addDays(today, -2))
    const shortSleep = recent.filter(r => r.sleep && r.sleep < 6)
    if (shortSleep.length >= 2) {
      out.push({ level: 'info', title: '最近几天睡眠不足 6 小时', detail: '睡眠是恢复最重要的一环，睡不够时把强度课换成轻松跑。' })
    }
    const tired = recent.filter(r => r.fatigue >= 7)
    if (tired.length) {
      out.push({ level: 'info', title: `疲劳自评 ${tired[tired.length - 1].fatigue}/10`, detail: '感觉很累时，休息一天通常比硬跑更有用。' })
    }

    // 5) 不适记录
    const pains = records.filter(r => r.note && r.date >= addDays(today, -7))
    if (pains.length) {
      const p = pains.sort((a, b) => a.date < b.date ? 1 : -1)[0]
      out.push({
        level: 'warn',
        title: `${p.date.slice(5)} 记录了不适：${p.note.slice(0, 30)}`,
        detail: '跑步时疼痛加重、第二天还疼、或者疼得改变了跑姿，就先停跑。持续一周不好转请去看医生（运动医学科/骨科）。'
      })
    }

    return out
  }

  // ---------------------------------------------------------------- 13 周计划
  // 3 次/周，隔天跑。r = 跑（分钟），w = 走（分钟），x = 重复次数；parts = 不重复的组合。

  const PLAN = [
    { week: 1, title: '找节奏', s: [{ r: 1, w: 2, x: 8 }, { r: 1, w: 2, x: 6 }, { r: 1, w: 2, x: 7 }] },
    { week: 2, title: '打基础', s: [{ r: 2, w: 2, x: 7 }, { r: 1, w: 2, x: 7 }, { r: 2, w: 2, x: 6 }] },
    { week: 3, title: '延长跑步时间', s: [{ r: 3, w: 2, x: 7 }, { r: 2, w: 2, x: 6 }, { r: 3, w: 2, x: 6 }] },
    { week: 4, title: '恢复周', s: [{ r: 3, w: 2, x: 6 }, { r: 2, w: 2, x: 5 }, { r: 2, w: 3, x: 6 }] },
    { week: 5, title: '放松跑姿', s: [{ r: 3, w: 1, x: 9 }, { r: 2, w: 1, x: 8 }, { r: 3, w: 1, x: 8 }] },
    { week: 6, title: '加量', s: [{ r: 5, w: 1, x: 7 }, { r: 3, w: 1, x: 7 }, { r: 3, w: 1, x: 10 }] },
    { week: 7, title: '过半了', s: [{ r: 10, w: 1, x: 4 }, { r: 4, w: 1, x: 6 }, { r: 5, w: 1, x: 7 }] },
    { week: 8, title: '恢复周', s: [{ r: 10, w: 1, x: 4 }, { r: 3, w: 1, x: 7 }, { r: 5, w: 1, x: 6 }] },
    { week: 9, title: '回到正轨', s: [{ parts: [[10, 1], [15, 1], [20, 1], [10, 0]] }, { r: 5, w: 1, x: 6 }, { r: 10, w: 1, x: 4 }] },
    { week: 10, title: '关键一周', s: [{ parts: [[10, 1], [20, 1], [30, 0]] }, { r: 10, w: 1, x: 4 }, { parts: [[20, 1], [15, 1], [10, 0]] }] },
    { week: 11, title: '建立信心', s: [{ parts: [[40, 1], [20, 0]] }, { r: 10, w: 1, x: 4 }, { parts: [[20, 1], [15, 1], [10, 0]] }] },
    { week: 12, title: '轻松量周', s: [{ parts: [[50, 0]] }, { r: 10, w: 1, x: 3 }, { parts: [[15, 1], [15, 1], [10, 0]] }] },
    { week: 13, title: '完赛', s: [{ parts: [[40, 0]] }, { r: 10, w: 1, x: 3 }, { race: 10 }] }
  ]

  // 展开成 39 次课，带编号、总分钟、文字描述
  function planSessions () {
    const out = []
    PLAN.forEach(wk => wk.s.forEach((s, i) => {
      let min, text
      if (s.race) {
        min = null
        text = `${s.race} 公里，按感觉跑，享受它`
      } else if (s.parts) {
        min = s.parts.reduce((a, [r, w]) => a + r + w, 0)
        text = s.parts.map(([r, w]) => w ? `跑 ${r}′ 走 ${w}′` : `跑 ${r}′`).join(' → ')
      } else {
        min = (s.r + s.w) * s.x
        text = `(跑 ${s.r}′ + 走 ${s.w}′) × ${s.x}`
      }
      out.push({ no: out.length + 1, week: wk.week, weekTitle: wk.title, idx: i + 1, min, text, race: !!s.race })
    }))
    return out
  }

  // ---------------------------------------------------------------- 导入导出

  const LEGACY_TYPES = { easy: 'easy', base: 'base', long: 'long', interval: 'interval' }

  // 兼容旧版 runlog.bot100.store 导出的数组格式
  function normalizeImport (data) {
    const num = v => (v === '' || v == null || +v === 0 || isNaN(+v)) ? null : +v
    if (Array.isArray(data)) {
      return {
        profile: null,
        planDone: {},
        records: data.filter(r => r && r.date).map((r, i) => ({
          id: 'legacy-' + i + '-' + r.date,
          date: r.date,
          type: LEGACY_TYPES[r.trainingType] || (num(r.distance) ? 'easy' : 'rest'),
          km: num(r.distance),
          min: num(r.duration),
          rpe: num(r.rpe),
          restHr: num(r.restingHR),
          hrv: num(r.hrv),
          sleep: num(r.sleep),
          fatigue: num(r.fatigue),
          weight: num(r.weight),
          note: (r.injury || '').trim(),
          plan: null
        }))
      }
    }
    if (data && Array.isArray(data.records)) {
      return { profile: data.profile || null, planDone: data.planDone || {}, records: data.records }
    }
    throw new Error('无法识别的文件格式')
  }

  const api = {
    parsePace, fmtPace, fmtDuration, RACES, splits, riegel,
    maxHrByAge, DANIELS_ZONES, hrZones,
    TYPES, parseDate, ymd, weekStart, addDays, sessionLoad, weeklySummary, restHrStatus, alerts,
    PLAN, planSessions, normalizeImport
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.RunCalc = api
})(this)
