/* global RunCalc, ICONS */
(function () {
  'use strict'
  const C = RunCalc
  const $ = id => document.getElementById(id)
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v
  const today = () => C.ymd(new Date())
  const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  // 13 周计划出处，定下来后改这里
  const PLAN_CREDIT = ''

  const icon = name => `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`

  // 带 data-icon 的元素：空元素直接填图标，有文字的在前面插一个图标
  function paintIcons (root) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      if (el.dataset.painted) return
      el.dataset.painted = '1'
      if (!el.textContent.trim() && !el.children.length) el.innerHTML = icon(el.dataset.icon)
      else el.insertAdjacentHTML('afterbegin', `<span aria-hidden="true">${icon(el.dataset.icon)}</span>`)
    })
  }
  paintIcons(document)

  // ---------------------------------------------------------------- 存储
  // 一个键存全部：{ profile, records, planDone, pace }。浏览器禁用存储时退化成内存。

  const KEY = 'run.bot100.v1'
  let db = { profile: {}, records: [], planDone: {}, pace: {} }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) db = Object.assign(db, JSON.parse(raw))
  } catch (e) { /* 隐私模式等 */ }

  function save () {
    try { localStorage.setItem(KEY, JSON.stringify(db)) } catch (e) { /* ignore */ }
  }

  function toast (text) {
    const t = $('toast')
    t.textContent = text
    t.classList.add('show')
    clearTimeout(toast.timer)
    toast.timer = setTimeout(() => t.classList.remove('show'), 2000)
  }

  function msg (id, text, kind) {
    const el = $(id)
    if (!text) { el.hidden = true; return }
    el.textContent = text
    el.className = 'msg' + (kind ? ' ' + kind : '')
    el.hidden = false
  }

  const hmsSec = (h, m, s) => (num($(h).value) || 0) * 3600 + (num($(m).value) || 0) * 60 + (num($(s).value) || 0)

  // ---------------------------------------------------------------- 路由
  // #today #plan #log #tools/pace|predict|hr；旧链接 #pace #hr 兼容

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  const TABS = ['today', 'plan', 'log', 'tools']
  const SUBS = ['pace', 'predict', 'hr']
  let curTab = null

  function route () {
    let [tab, sub] = location.hash.slice(1).split('/')
    if (tab === 'pace' || tab === 'hr') { sub = tab; tab = 'tools' }
    if (!TABS.includes(tab)) tab = 'today'
    if (tab === 'tools' && !SUBS.includes(sub)) sub = 'pace'

    TABS.forEach(t => { $('tab-' + t).hidden = t !== tab })
    document.querySelectorAll('.nav a[data-tab]').forEach(a => {
      a.classList.toggle('on', a.dataset.tab === tab)
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
    if (tab === 'tools') {
      SUBS.forEach(s => { $('sub-' + s).hidden = s !== sub })
      document.querySelectorAll('.segmented a[data-sub]').forEach(a => {
        a.classList.toggle('on', a.dataset.sub === sub)
        a.setAttribute('aria-selected', a.dataset.sub === sub)
      })
      if (sub === 'hr') renderHrBaseline()
    }
    $('fab').classList.toggle('hide', tab === 'tools')
    renderTab(tab)
    if (tab !== curTab) window.scrollTo(0, 0)
    curTab = tab
  }
  window.addEventListener('hashchange', route)

  function renderTab (tab) {
    if (tab === 'today') renderToday()
    if (tab === 'plan') renderPlan()
    if (tab === 'log') renderLog()
  }

  // ---------------------------------------------------------------- 今天

  function renderToday () {
    const t = today()
    const d = C.parseDate(t)
    $('todayDate').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEKDAY[d.getDay()]}`

    // 本周
    const ws = C.weekStart(t)
    const weeks = C.weeklySummary(db.records, t)
    const cur = weeks.length && weeks[weeks.length - 1].week === ws ? weeks[weeks.length - 1] : null
    $('tKm').textContent = cur ? +cur.km.toFixed(1) : 0
    $('tRuns').textContent = cur ? cur.runs : 0
    $('tLoad').textContent = cur ? Math.round(cur.load) : 0
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = C.addDays(ws, i)
      const rs = db.records.filter(r => r.date === date)
      return { date, km: rs.reduce((a, r) => a + (r.km || 0), 0), rest: rs.length && rs.every(r => r.type === 'rest') }
    })
    const maxKm = Math.max(3, ...days.map(x => x.km))
    $('tDays').innerHTML = days.map(x => `
      <div class="day${x.date === t ? ' today' : ''}${x.date > t ? ' future' : ''}" title="${x.date}${x.km ? ' ' + +x.km.toFixed(1) + ' 公里' : ''}">
        <div class="bar${x.rest ? ' rest' : ''}"><i style="height:${x.km / maxKm * 100}%"></i></div>
        <span>${WEEKDAY[C.parseDate(x.date).getDay()].slice(1)}</span>
      </div>`).join('')

    // 身体状态：首页只放前 2 条，其余折叠
    $('tAlerts').innerHTML = alertsHtml(alertsOpen ? 0 : 2)

    // 下一次训练
    const next = SESSIONS.find(s => !db.planDone[s.no])
    $('tNext').innerHTML = next
      ? `<div class="next-card">
          <div><div class="meta">第 ${next.week} 周第 ${next.idx} 次${next.min ? `，共 ${next.min} 分钟` : ''}</div><div class="what">${esc(next.text)}</div></div>
          <div class="btn-row"><button class="btn primary" data-finish="${next.no}">完成并记录</button><button class="btn" data-tick="${next.no}">只打勾</button></div>
        </div>`
      : '<div class="next-card"><div class="what">13 周计划全部完成</div><div class="meta">接下来保持每周 3 次，继续在日志里记录。</div></div>'

    // 心率区间
    const p = db.profile || {}
    const max = p.maxHr || (p.age ? C.maxHrByAge(p.age) : null)
    $('tZones').innerHTML = p.restHr && max
      ? `<div class="zone-mini">${C.hrZones(p.restHr, max).map(z => `
          <div style="--c: var(${ZONE_COLOR[z.key]}); --ct: var(${ZONE_COLOR[z.key]}t)"><span class="k">${z.key}</span><span><b>${z.bpmLo}-${z.bpmHi}</b><small>${z.name}</small></span></div>`).join('')}</div>`
      : '<div class="set-prompt"><p>填一下静息心率和年龄，这里就会显示你的轻松跑、阈值跑心率。</p><a class="btn" href="#tools/hr">去设置</a></div>'
  }

  $('tNext').addEventListener('click', e => {
    const fin = e.target.closest('[data-finish]')
    const tick = e.target.closest('[data-tick]')
    if (fin) {
      const s = SESSIONS[fin.dataset.finish - 1]
      openSheet({ plan: s.no, min: s.min })
    } else if (tick) {
      db.planDone[tick.dataset.tick] = today()
      save()
      renderToday()
      toast('已打勾')
    }
  })

  let alertsOpen = false
  $('tAlerts').addEventListener('click', e => {
    if (e.target.closest('[data-more-alerts]')) { alertsOpen = true; renderToday() }
  })

  function alertsHtml (limit) {
    const al = C.alerts(db.records, today())
    if (!db.records.length) {
      return `<div class="alert info">${icon('log')}<div><b>还没有数据</b><p>每次跑完记一笔，早上顺手记晨起心率和睡眠，这里会告诉你该加量、维持还是休息。</p></div></div>`
    }
    if (!al.length) {
      return `<div class="alert ok">${icon('check')}<div><b>状态不错</b><p>跑量增长和恢复指标都在正常范围。</p></div></div>`
    }
    const shown = limit ? al.slice(0, limit) : al
    const more = al.length - shown.length
    return shown.map(a => `<div class="alert ${a.level}">${icon('warn')}<div><b>${esc(a.title)}</b><p>${esc(a.detail)}</p></div></div>`).join('') +
      (more ? `<button class="btn more-alerts" data-more-alerts>还有 ${more} 条提醒</button>` : '')
  }

  // ---------------------------------------------------------------- 配速

  let splits = []

  $('pPresets').innerHTML = C.RACES.map(r => `<button class="chip" data-km="${r.km}">${r.name}</button>`).join('')
  $('pPresets').addEventListener('click', e => {
    const b = e.target.closest('.chip')
    if (!b) return
    $('pDist').value = b.dataset.km
    syncChips()
  })
  $('pDist').addEventListener('input', syncChips)
  function syncChips () {
    document.querySelectorAll('#pPresets .chip').forEach(c => c.classList.toggle('on', +c.dataset.km === +$('pDist').value))
  }

  $('pCalc').addEventListener('click', () => {
    const km = num($('pDist').value)
    const sec = hmsSec('pH', 'pM', 'pS')
    msg('pMsg', '')
    if (!km || km <= 0) return msg('pMsg', '请填距离')
    if (!sec) return msg('pMsg', '请填目标用时')
    const avg = sec / km
    if (avg < 150 || avg > 1200) return msg('pMsg', `平均配速会是 ${C.fmtPace(avg)}/公里，检查一下输入`)
    const step = +$('pStep').value
    const prog = num($('pProg').value) || 0
    splits = C.splits(km, sec, step, prog)
    if (splits.some(s => s.pace < 120)) return msg('pMsg', '提速幅度太大，后程配速快得不现实，调小一点')
    db.pace = { km, sec, step, prog }
    save()
    $('pAvg').textContent = C.fmtPace(avg)
    $('pSpeed').textContent = (3600 / avg).toFixed(1)
    renderSplits()
    $('pResult').hidden = false
    $('pResult').scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  function renderSplits () {
    $('pSplits').innerHTML = splits.map((s, i) => `<tr>
      <td>${s.no}</td>
      <td class="num">${+s.cumKm.toFixed(2)} km</td>
      <td><input value="${C.fmtPace(s.pace)}" data-i="${i}" inputmode="numeric" aria-label="第 ${s.no} 段配速"></td>
      <td class="num">${C.fmtDuration(s.sec)}</td></tr>`).join('')
    $('pTotal').textContent = C.fmtDuration(splits.reduce((a, s) => a + s.sec, 0))
  }

  $('pSplits').addEventListener('change', e => {
    const i = e.target.dataset.i
    if (i == null) return
    const p = C.parsePace(e.target.value)
    if (!p) { e.target.classList.add('bad'); return }
    splits[i].pace = p
    splits[i].sec = p * splits[i].km
    renderSplits()
  })

  // 成绩预测
  $('rDist').innerHTML = C.RACES.map(r => `<option value="${r.km}">${r.name}</option>`).join('')
  $('rCalc').addEventListener('click', () => {
    const km = +$('rDist').value
    const sec = hmsSec('rH', 'rM', 'rS')
    msg('rMsg', '')
    if (!sec) return msg('rMsg', '请填成绩')
    const pace = sec / km
    if (pace < 150 || pace > 1200) return msg('rMsg', `这个成绩的配速是 ${C.fmtPace(pace)}/公里，检查一下输入`)
    $('rBody').innerHTML = C.RACES.map(r => {
      const t = r.km === km ? sec : C.riegel(km, sec, r.km)
      return `<li><span class="l">${r.name}${r.km === km ? '<span class="tag">实测</span>' : ''}</span><span class="r"><b>${C.fmtDuration(t)}</b><small>${C.fmtPace(t / r.km)} /km</small></span></li>`
    }).join('')
    $('rResult').hidden = false
  })

  // 恢复上次的配速输入
  if (db.pace && db.pace.km) {
    $('pDist').value = db.pace.km
    const s = db.pace.sec
    $('pH').value = Math.floor(s / 3600) || ''
    $('pM').value = Math.floor((s % 3600) / 60)
    $('pS').value = s % 60 || ''
    $('pStep').value = db.pace.step
    $('pProg').value = db.pace.prog
    syncChips()
  }

  // ---------------------------------------------------------------- 心率

  const ZONE_COLOR = { E: '--z1', M: '--z2', T: '--z3', I: '--z4' }
  const p0 = db.profile || {}
  if (p0.restHr) $('hRest').value = p0.restHr
  if (p0.maxHr) $('hMax').value = p0.maxHr
  if (p0.age) $('hAge').value = p0.age

  function renderHrBaseline () {
    const st = C.restHrStatus(db.records)
    const el = $('hBaseline')
    if (!st || Math.round(st.baseline) === num($('hRest').value)) { el.hidden = true; return }
    el.innerHTML = `训练日志里你近 4 周的晨起心率中位数是 <b>${Math.round(st.baseline)}</b>。<button class="btn text" id="hUseBase">用这个</button>`
    el.hidden = false
    $('hUseBase').onclick = () => { $('hRest').value = Math.round(st.baseline); el.hidden = true; calcHr() }
  }

  function calcHr (silent) {
    const rest = num($('hRest').value)
    const maxIn = num($('hMax').value)
    const age = num($('hAge').value)
    msg('hMsg', '')
    if (!rest) return silent || msg('hMsg', '请填晨起静息心率')
    if (rest < 30 || rest > 100) return silent || msg('hMsg', '静息心率一般在 30 到 100 之间，检查一下')
    if (!maxIn && !age) return silent || msg('hMsg', '最大心率和年龄至少填一个')
    if (maxIn && (maxIn < 120 || maxIn > 230)) return silent || msg('hMsg', '最大心率一般在 120 到 230 之间，检查一下')
    const max = maxIn || C.maxHrByAge(age)
    if (rest >= max - 30) return silent || msg('hMsg', '静息心率和最大心率太接近了，检查一下')
    db.profile = { restHr: rest, maxHr: maxIn, age }
    save()
    $('hRestOut').textContent = rest
    $('hMaxOut').textContent = max
    $('hMaxLabel').textContent = maxIn ? '最大心率' : '最大心率（估算）'
    $('hHrrOut').textContent = max - rest
    $('hZones').innerHTML = C.hrZones(rest, max).map(z => `
      <div class="zone" style="--c: var(${ZONE_COLOR[z.key]}); --ct: var(${ZONE_COLOR[z.key]}t)">
        <div class="k">${z.key}</div>
        <div class="n">${z.name}<span class="dim">${Math.round(z.lo * 100)}-${Math.round(z.hi * 100)}%</span></div>
        <div class="bpm">${z.bpmLo}-${z.bpmHi}<small>次/分</small></div>
        <div class="d">${z.feel}。${z.use}</div>
      </div>`).join('')
    $('hResult').hidden = false
    if (!silent) $('hResult').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  $('hCalc').addEventListener('click', () => calcHr())
  if (p0.restHr) calcHr(true)

  // ---------------------------------------------------------------- 13 周计划

  const SESSIONS = C.planSessions()
  $('planCredit').textContent = PLAN_CREDIT

  function renderPlan () {
    const done = db.planDone
    const n = SESSIONS.filter(s => done[s.no]).length
    const next = SESSIONS.find(s => !done[s.no])
    const curWeek = next ? next.week : 0
    $('planCount').textContent = n
    $('planGrid').innerHTML = SESSIONS.map(s => `<i class="${done[s.no] ? 'done' : next && s.no === next.no ? 'next' : ''}"></i>`).join('')
    $('planWeeks').innerHTML = C.PLAN.map(wk => {
      const list = SESSIONS.filter(s => s.week === wk.week)
      const allDone = list.every(s => done[s.no])
      return `
      <div class="week${wk.week === curWeek ? ' cur' : ''}${allDone ? ' all-done' : ''}">
        <h3><span class="wk">W${String(wk.week).padStart(2, '0')}</span>${wk.title}${wk.week === curWeek ? '<span class="cur-tag">本周</span>' : ''}</h3>
        ${list.map(s => `
          <label class="sess${done[s.no] ? ' done' : ''}">
            <input type="checkbox" data-no="${s.no}"${done[s.no] ? ' checked' : ''}>
            <span class="box">${icon('check')}</span>
            <span class="t">${esc(s.text)}<small>第 ${s.no} 次${done[s.no] ? `，${done[s.no].slice(5)} 完成` : ''}</small></span>
            <span class="m">${s.min ? s.min + ' 分' : icon('flag') + '10K'}</span>
          </label>`).join('')}
      </div>`
    }).join('')
  }

  $('planWeeks').addEventListener('change', e => {
    const no = e.target.dataset.no
    if (!no) return
    if (e.target.checked) {
      db.planDone[no] = today()
      toast('已完成，点右下角可以记下这次的感受')
    } else {
      delete db.planDone[no]
    }
    save()
    renderPlan()
  })

  // ---------------------------------------------------------------- 记一笔（底部面板）

  const sheet = $('sheet')
  const RUN_TYPES = Object.entries(C.TYPES).filter(([k]) => k !== 'rest')
  $('fType').innerHTML = RUN_TYPES.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')
  $('fTypeSeg').innerHTML = '<button type="button" data-kind="run" role="radio">跑步</button><button type="button" data-kind="rest" role="radio">休息日 / 晨起数据</button>'
  $('fRpe').innerHTML = Array.from({ length: 10 }, (_, i) => `<button type="button" data-v="${i + 1}" aria-pressed="false">${i + 1}</button>`).join('')
  const RPE_TEXT = ['', '很轻松', '很轻松', '轻松，能聊天', '中等', '中等，能说短句', '有点吃力', '吃力', '很吃力', '接近全力', '全力']
  let rpe = null
  let kind = 'run'

  function setKind (k) {
    kind = k
    document.querySelectorAll('#fTypeSeg button').forEach(b => {
      b.classList.toggle('on', b.dataset.kind === k)
      b.setAttribute('aria-checked', b.dataset.kind === k)
    })
    document.querySelectorAll('.run-only').forEach(el => { el.hidden = k === 'rest' })
    $('fMorning').open = k === 'rest'
  }
  $('fTypeSeg').addEventListener('click', e => {
    const b = e.target.closest('button')
    if (b) setKind(b.dataset.kind)
  })

  function resetForm () {
    $('fDate').value = today()
    $('fType').value = 'easy'
    ;['fKm', 'fMin', 'fRestHr', 'fHrv', 'fSleep', 'fFatigue', 'fWeight', 'fNote'].forEach(id => { $(id).value = '' })
    setRpe(null)
    fillPlanSelect()
    $('fPlan').value = ''
    setKind('run')
    updatePace()
    msg('fMsg', '')
  }

  function openSheet (prefill) {
    resetForm()
    if (prefill) {
      if (prefill.plan) $('fPlan').value = prefill.plan
      if (prefill.min) $('fMin').value = prefill.min
      updatePace()
    }
    if (typeof sheet.showModal === 'function') sheet.showModal()
    else sheet.setAttribute('open', '')
  }
  function closeSheet () {
    if (typeof sheet.close === 'function') sheet.close()
    else sheet.removeAttribute('open')
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-open-sheet]')) openSheet() })
  $('sheetClose').addEventListener('click', closeSheet)
  // 点遮罩关闭
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet() })

  function setRpe (v) {
    rpe = v
    document.querySelectorAll('#fRpe button').forEach(b => {
      const on = +b.dataset.v === v
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', on)
    })
    $('fRpeLabel').textContent = v ? RPE_TEXT[v] : '选一个'
  }
  $('fRpe').addEventListener('click', e => {
    const b = e.target.closest('button')
    if (b) setRpe(+b.dataset.v === rpe ? null : +b.dataset.v)
  })

  function updatePace () {
    const km = num($('fKm').value)
    const min = num($('fMin').value)
    $('fPace').textContent = km && min ? C.fmtPace(min * 60 / km) + ' /km' : '--:--'
  }
  $('fKm').addEventListener('input', updatePace)
  $('fMin').addEventListener('input', updatePace)

  function fillPlanSelect () {
    const next = SESSIONS.find(s => !db.planDone[s.no])
    $('fPlan').innerHTML = '<option value="">不对应</option>' + SESSIONS.map(s =>
      `<option value="${s.no}">第 ${s.week} 周第 ${s.idx} 次：${esc(s.text)}${db.planDone[s.no] ? '（已完成）' : ''}${next && s.no === next.no ? '（下一次）' : ''}</option>`).join('')
  }

  $('fSave').addEventListener('click', () => {
    const rest = kind === 'rest'
    const r = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: $('fDate').value,
      type: rest ? 'rest' : $('fType').value,
      km: rest ? null : num($('fKm').value),
      min: rest ? null : num($('fMin').value),
      rpe: rest ? null : rpe,
      restHr: num($('fRestHr').value),
      hrv: num($('fHrv').value),
      sleep: num($('fSleep').value),
      fatigue: num($('fFatigue').value),
      weight: num($('fWeight').value),
      note: $('fNote').value.trim(),
      plan: rest ? null : num($('fPlan').value)
    }
    msg('fMsg', '')
    if (!r.date) return msg('fMsg', '请选日期')
    if (!rest) {
      if (!r.min) return msg('fMsg', '请填用时，训练负荷要用它算')
      if (!r.rpe) return msg('fMsg', '选一下跑完多累（RPE）')
    } else if (!r.restHr && !r.sleep && !r.fatigue && !r.weight && !r.hrv && !r.note) {
      return msg('fMsg', '至少填一项晨起数据')
    }
    db.records.push(r)
    if (r.plan && !db.planDone[r.plan]) db.planDone[r.plan] = r.date
    save()
    closeSheet()
    renderTab(curTab)
    toast('已保存')
  })

  // ---------------------------------------------------------------- 日志

  let showAll = false
  $('lShowAll').addEventListener('click', () => { showAll = true; renderLog() })

  $('lList').addEventListener('click', e => {
    const b = e.target.closest('.del')
    if (!b) return
    if (!b.classList.contains('armed')) {
      b.classList.add('armed')
      b.textContent = '确认删除'
      setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.innerHTML = icon('trash') } }, 3000)
      return
    }
    db.records = db.records.filter(x => x.id !== b.dataset.del)
    save()
    renderLog()
    toast('已删除')
  })

  const dash = '<span class="dim">-</span>'

  function renderLog () {
    const t = today()
    const has = db.records.length > 0
    $('lEmpty').hidden = has
    const weeks = C.weeklySummary(db.records, t)
    $('lWeeksCard').hidden = !weeks.length
    if (weeks.length) {
      const shown = weeks.slice(-12)
      $('lWeeks').innerHTML = shown.slice().reverse().map(w => {
        const now = w.week === C.weekStart(t)
        const ch = w.kmChange
        const chTxt = now || ch == null ? dash
          : `<span class="${ch > 0.1 ? 'up' + (ch > 0.3 ? ' bad' : '') : ''}">${ch > 0 ? '+' : ''}${Math.round(ch * 100)}%</span>`
        const ac = w.acwr == null || (now && !(w.acwr > 1.3)) ? dash
          : `<span class="${w.acwr > 1.5 ? 'up bad' : w.acwr > 1.3 ? 'up' : ''}">${w.acwr.toFixed(2)}</span>`
        return `<tr><td class="num">${w.week.slice(5)}${now ? '<span class="tag">本周</span>' : ''}</td><td class="num">${+w.km.toFixed(1)}</td><td class="num">${chTxt}</td><td class="num">${w.runs}</td><td class="num">${Math.round(w.load)}</td><td class="num">${ac}</td></tr>`
      }).join('')
      $('lChart').innerHTML = chart(shown)
    }

    const list = db.records.slice().sort((a, b) => a.date === b.date ? (a.id < b.id ? 1 : -1) : (a.date < b.date ? 1 : -1))
    $('lListCard').hidden = !has
    const visible = showAll ? list : list.slice(0, 20)
    $('lShowAll').hidden = showAll || list.length <= 20
    $('lList').innerHTML = visible.map(r => {
      const plan = r.plan ? SESSIONS[r.plan - 1] : null
      const main = r.type === 'rest'
        ? '<span class="ty">休息日</span>'
        : `<span class="ty">${C.TYPES[r.type] || esc(r.type)}</span>${[r.km && +r.km.toFixed(2) + ' km', r.min && Math.round(r.min) + ' 分钟', r.km && r.min && C.fmtPace(r.min * 60 / r.km) + ' /km'].filter(Boolean).join('，')}`
      const meta = [
        r.rpe && `RPE ${r.rpe}`,
        r.restHr && `晨起心率 ${r.restHr}`,
        r.hrv && `HRV ${r.hrv}`,
        r.sleep && `睡眠 ${r.sleep} 小时`,
        r.fatigue && `疲劳 ${r.fatigue}`,
        r.weight && `${r.weight} kg`,
        plan && `计划 W${plan.week} 第 ${plan.idx} 次`
      ].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')
      return `<li>
        <span class="d">${r.date.slice(5)}<small>${WEEKDAY[C.parseDate(r.date).getDay()]}</small></span>
        <div><div class="main">${main}</div>${meta ? `<div class="meta">${meta}</div>` : ''}${r.note ? `<div class="note-line">${icon('warn')}<span>${esc(r.note)}</span></div>` : ''}</div>
        <button class="del" data-del="${esc(r.id)}" aria-label="删除这条记录">${icon('trash')}</button>
      </li>`
    }).join('')
  }

  // 每周跑量柱 + ACWR 点线，纯 SVG
  function chart (weeks) {
    const W = 640, H = 170, L = 8, R = 30, T = 18, B = 22
    const n = weeks.length
    const bw = (W - L - R) / n
    const maxKm = Math.max(5, ...weeks.map(w => w.km)) * 1.15
    const y = km => T + (1 - km / maxKm) * (H - T - B)
    const ya = a => T + (1 - Math.min(a, 2) / 2) * (H - T - B)
    const thisWeek = C.weekStart(today())
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每周跑量与 ACWR">`
    s += `<rect x="${L}" y="${ya(1.3)}" width="${W - L - R}" height="${ya(0.8) - ya(1.3)}" fill="var(--sunken)"/>`
    weeks.forEach((w, i) => {
      const x = L + i * bw
      const cur = w.week === thisWeek
      s += `<rect x="${x + bw * 0.2}" y="${y(w.km)}" width="${bw * 0.6}" height="${H - B - y(w.km)}" rx="4" fill="var(--accent)" opacity="${cur ? 0.45 : 0.9}"/>`
      if (w.km > 0) s += `<text x="${x + bw / 2}" y="${y(w.km) - 5}" text-anchor="middle">${+w.km.toFixed(1)}</text>`
      s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${w.week.slice(5)}</text>`
    })
    const pts = weeks.map((w, i) => w.acwr == null || (w.week === thisWeek && !(w.acwr > 1.3)) ? null : [L + i * bw + bw / 2, ya(w.acwr)])
    let path = ''
    pts.forEach((p, i) => { if (p) path += (pts[i - 1] ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) })
    if (path) {
      s += `<path d="${path}" fill="none" stroke="var(--ink)" stroke-width="1.5"/>`
      pts.forEach(p => { if (p) s += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.5"/>` })
      s += `<text x="${W - R + 4}" y="${ya(1.3) + 4}">1.3</text><text x="${W - R + 4}" y="${ya(0.8) + 4}">0.8</text>`
    }
    s += '</svg>'
    return s + `<div class="legend"><span><i style="background:var(--accent)"></i>每周公里</span>${path ? '<span><i style="background:var(--ink);height:2px;vertical-align:3px"></i>ACWR，灰带为 0.8 到 1.3</span>' : ''}</div>`
  }

  // ---------------------------------------------------------------- 导入导出

  $('dExport').addEventListener('click', () => {
    const data = { app: 'run.bot100.store', version: 1, exportedAt: new Date().toISOString(), profile: db.profile, records: db.records, planDone: db.planDone }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `跑步记录_${today()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })

  $('dImport').addEventListener('click', () => $('dFile').click())
  $('dFile').addEventListener('change', e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = C.normalizeImport(JSON.parse(rd.result))
        // 合并：同一天同类型同距离的视为重复
        const sig = r => [r.date, r.type, r.km, r.min, r.restHr].join('|')
        const have = new Set(db.records.map(sig))
        const fresh = data.records.filter(r => !have.has(sig(r)))
        db.records = db.records.concat(fresh)
        db.planDone = Object.assign({}, data.planDone, db.planDone)
        if (data.profile && !(db.profile && db.profile.restHr)) db.profile = data.profile
        save()
        renderLog()
        const dup = data.records.length - fresh.length
        msg('dMsg', `导入 ${fresh.length} 条记录${dup ? `，跳过 ${dup} 条重复` : ''}`, 'ok')
      } catch (err) {
        msg('dMsg', '文件读不出来：' + err.message)
      }
    }
    rd.readAsText(f)
  })

  // ---------------------------------------------------------------- 启动

  route()
})()
