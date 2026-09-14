/* ================= Storage keys ================= */
const STORAGE_KEY_HISTORY = 'kddiQuizHistory_v1';
const PROGRESS_KEY = 'kddiQuizProgress_v1';
const MAX_HISTORY = 10;
const CATEGORIES = ['スターリンク', 'WVS2', 'BGP', 'VXLAN'];

/* ================= Storage utilities ================= */
function formatDateLabel(d) {
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function normalizeAttempt(att) {
  const total = Number(att.total) || 0;
  const score = Number(att.score) || 0;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  let dateLabel = att.date;
  if (typeof dateLabel !== 'string' || /^\d{4}-\d{2}-\d{2}T/.test(dateLabel)) {
    const parsed = new Date(dateLabel);
    dateLabel = isNaN(parsed.getTime()) ? '' : formatDateLabel(parsed);
  }
  return { ...att, score, total, pct, date: dateLabel };
}
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return { attempts: [], missed: {} };
    const parsed = JSON.parse(raw);
    return { attempts: (parsed.attempts || []).map(normalizeAttempt), missed: parsed.missed || {} };
  } catch (e) { return { attempts: [], missed: {} }; }
}
function saveHistory(h) {
  try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(h)); } catch (e) {}
}
function saveProgress(s) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(s)); } catch (e) {} }
function loadProgress() { try { const r = localStorage.getItem(PROGRESS_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function clearProgress() { try { localStorage.removeItem(PROGRESS_KEY); } catch (e) {} }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ================= Global state ================= */
let history = loadHistory();
saveHistory(history);

let selectedCategory = 'all';
let selectedCount = Math.min(20, ALL_QUESTIONS.length);

let state = {
  queue: [],
  index: 0,
  score: 0,
  wrong: [],
  answers: [],
};

const screens = {
  start: document.getElementById('screen-start'),
  quiz: document.getElementById('screen-quiz'),
  result: document.getElementById('screen-result'),
  'history-detail': document.getElementById('screen-history-detail'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function poolByCategory() {
  if (selectedCategory === 'all') return ALL_QUESTIONS;
  return ALL_QUESTIONS.filter(q => q.category === selectedCategory);
}

/* ================= Start screen ================= */
function renderCatChips() {
  const el = document.getElementById('catToggle');
  el.querySelectorAll('.cat-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === selectedCategory);
  });
}
document.getElementById('catToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-chip');
  if (!btn) return;
  selectedCategory = btn.dataset.cat;
  renderCatChips();
  renderCountChips();
});

function renderCountChips() {
  const pool = poolByCategory();
  const max = pool.length;
  const steps = [10, 20, 30, 50, 100];
  if (!steps.includes(max)) steps.push(max);
  const opts = steps.filter(n => n <= max).sort((a, b) => a - b);
  if (selectedCount > max) selectedCount = max;
  const el = document.getElementById('countChips');
  el.innerHTML = '';
  opts.forEach(n => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'count-chip' + (n === selectedCount ? ' active' : '');
    b.textContent = `${n}問`;
    b.addEventListener('click', () => {
      selectedCount = n;
      renderCountChips();
    });
    el.appendChild(b);
  });
  document.getElementById('countHint').textContent = `このカテゴリの出題数は最大${max}問です`;
}

function renderStartStats() {
  const statsPanel = document.getElementById('statsPanel');
  const statsEmpty = document.getElementById('statsEmpty');
  const attempts = history.attempts;
  if (attempts.length === 0) {
    statsPanel.style.display = 'none';
    statsEmpty.style.display = 'block';
    document.getElementById('resumeArea').style.display = loadProgress() ? 'block' : 'none';
    return;
  }
  statsPanel.style.display = 'block';
  statsEmpty.style.display = 'none';
  document.getElementById('statAttempts').textContent = attempts.length;
  document.getElementById('statBest').textContent = Math.max(...attempts.map(a => a.pct)) + '%';
  document.getElementById('statLast').textContent = attempts[attempts.length - 1].pct + '%';

  const listEl = document.getElementById('historyList');
  listEl.innerHTML = '';
  attempts.slice().reverse().forEach(att => {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `<span>${att.date}</span><span class="history-pct">${att.pct}% (${att.score}/${att.total})</span>`;
    row.addEventListener('click', () => showHistoryDetail(att));
    listEl.appendChild(row);
  });

  const missedIds = Object.keys(history.missed || {}).map(Number);
  document.getElementById('btnReviewWeak').style.display = missedIds.length > 0 ? 'inline-flex' : 'none';
  document.getElementById('resumeArea').style.display = loadProgress() ? 'block' : 'none';
}

document.querySelectorAll('.accordion-header').forEach(h => {
  h.addEventListener('click', () => {
    document.getElementById(h.dataset.target).classList.toggle('open');
  });
});

/* ================= Quiz flow ================= */
function startQuiz(qList) {
  state = { queue: qList, index: 0, score: 0, wrong: [], answers: [] };
  clearProgress();
  showScreen('quiz');
  renderQuestion();
}

function resumeQuiz() {
  const saved = loadProgress();
  if (!saved) return;
  state = saved;
  showScreen('quiz');
  renderQuestion();
}

function renderQuestion() {
  const q = state.queue[state.index];
  document.getElementById('progressFill').style.width = `${(state.index / state.queue.length) * 100}%`;
  document.getElementById('qCount').textContent = state.index + 1;
  document.getElementById('qTotal').textContent = state.queue.length;
  const badge = document.getElementById('qCategory');
  badge.textContent = q.category;
  badge.className = 'cat-badge ' + q.category;
  document.getElementById('qPrompt').textContent = q.prompt;

  const choicesEl = document.getElementById('choices');
  choicesEl.innerHTML = '';
  const marks = ['A', 'B', 'C', 'D'];
  q.choices.forEach((choice, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice-btn';
    b.innerHTML = `<span class="choice-mark">${marks[idx]}</span><span>${choice}</span>`;
    b.addEventListener('click', () => selectAnswer(idx));
    choicesEl.appendChild(b);
  });

  const panel = document.getElementById('answerPanel');
  panel.classList.remove('open');

  const nextBtn = document.getElementById('btnNext');
  nextBtn.disabled = true;
  const isLast = state.index === state.queue.length - 1;
  nextBtn.textContent = isLast ? '結果を見る' : '次の問題へ';

  saveProgress(state);
}

function selectAnswer(idx) {
  const q = state.queue[state.index];
  const buttons = document.querySelectorAll('.choice-btn');
  buttons.forEach(b => b.disabled = true);

  const isCorrect = idx === q.answerIndex;
  buttons.forEach((b, i) => {
    if (i === q.answerIndex) b.classList.add('correct');
    else if (i === idx) b.classList.add('wrong');
    else b.classList.add('dim');
  });

  if (isCorrect) {
    state.score++;
    if (history.missed && history.missed[q.id]) delete history.missed[q.id];
  } else {
    state.wrong.push(q);
    if (!history.missed) history.missed = {};
    history.missed[q.id] = (history.missed[q.id] || 0) + 1;
  }
  state.answers.push({ question: q, userIndex: idx, isCorrect });

  const panel = document.getElementById('answerPanel');
  const verdict = document.getElementById('apVerdict');
  verdict.textContent = isCorrect ? '正解！' : '不正解';
  verdict.className = 'ap-verdict ' + (isCorrect ? 'correct' : 'wrong');
  document.getElementById('apExplain').textContent = q.explanation;
  panel.classList.add('open');

  document.getElementById('btnNext').disabled = false;
  saveProgress(state);
}

document.getElementById('btnNext').addEventListener('click', () => {
  state.index++;
  if (state.index < state.queue.length) {
    renderQuestion();
  } else {
    finishQuiz();
  }
});

function finishQuiz() {
  clearProgress();
  const date = formatDateLabel(new Date());
  const attempt = { date, score: state.score, total: state.queue.length, pct: Math.round((state.score / state.queue.length) * 100), answers: state.answers.map(a => ({ question: a.question, userIndex: a.userIndex, isCorrect: a.isCorrect })) };
  history.attempts.push(attempt);
  if (history.attempts.length > MAX_HISTORY) history.attempts = history.attempts.slice(-MAX_HISTORY);
  saveHistory(history);
  renderResult(attempt);
  showScreen('result');
}

function renderResult(att) {
  document.getElementById('scoreRing').style.setProperty('--pct', att.pct);
  document.getElementById('scorePct').textContent = att.pct + '%';
  document.getElementById('scoreFrac').textContent = `${att.score} / ${att.total}`;
  document.getElementById('resultHeadline').textContent = att.pct >= 80 ? '素晴らしい正答率です' : att.pct >= 50 ? 'お疲れさまでした' : '復習していきましょう';
  document.getElementById('resultSub').textContent = `${att.date} の結果`;

  renderBreakdown('catBreakdown', att.answers);
  renderReview('reviewList', att.answers);
}

function renderBreakdown(elId, answers) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  const stats = {};
  answers.forEach(a => {
    const c = a.question.category;
    if (!stats[c]) stats[c] = { total: 0, correct: 0 };
    stats[c].total++;
    if (a.isCorrect) stats[c].correct++;
  });
  Object.keys(stats).forEach(cat => {
    const s = stats[cat];
    const pct = Math.round((s.correct / s.total) * 100);
    const row = document.createElement('div');
    row.innerHTML = `<div class="cat-row-top"><b>${cat}</b><span>${s.correct}/${s.total} (${pct}%)</span></div><div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%"></div></div>`;
    el.appendChild(row);
  });
}

function renderReview(elId, answers) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  answers.forEach(a => {
    const q = a.question;
    const item = document.createElement('div');
    item.className = 'review-item ' + (a.isCorrect ? 'correct' : 'wrong');
    let html = `<div class="rt"><span class="result-tag ${a.isCorrect ? 'correct' : 'wrong'}">${a.isCorrect ? '正解' : '不正解'}</span><span>${q.category}</span></div>
      <div class="term">${q.prompt}</div>
      <div class="meaning">${q.explanation}</div>`;
    if (!a.isCorrect) {
      html += `<div class="your-answer">あなたの回答: ${q.choices[a.userIndex]}</div>`;
    }
    item.innerHTML = html;
    el.appendChild(item);
  });
}

/* ================= History detail ================= */
function showHistoryDetail(att) {
  document.getElementById('hdScoreRing').style.setProperty('--pct', att.pct);
  document.getElementById('hdScorePct').textContent = att.pct + '%';
  document.getElementById('hdScoreFrac').textContent = `${att.score} / ${att.total}`;
  document.getElementById('hdDate').textContent = `${att.date} の結果`;
  renderBreakdownGeneric('hdCatBreakdown', att.answers);
  renderReviewGeneric('hdReviewList', att.answers);
  showScreen('history-detail');
}
function renderBreakdownGeneric(elId, answers) { renderBreakdown(elId, answers); }
function renderReviewGeneric(elId, answers) { renderReview(elId, answers); }

/* ================= Event wiring ================= */
document.getElementById('navBrand').addEventListener('click', () => { renderStartStats(); showScreen('start'); });

document.getElementById('btnStart').addEventListener('click', () => {
  const pool = poolByCategory();
  const qList = shuffle(pool).slice(0, selectedCount);
  startQuiz(qList);
});

document.getElementById('btnResume').addEventListener('click', resumeQuiz);

document.getElementById('btnReviewWeak').addEventListener('click', () => {
  const missedIds = Object.keys(history.missed || {}).map(Number);
  const weak = ALL_QUESTIONS.filter(q => missedIds.includes(q.id));
  startQuiz(shuffle(weak));
});

document.getElementById('btnHomeFromQuiz').addEventListener('click', () => {
  renderStartStats();
  showScreen('start');
});

document.getElementById('btnRetryWrong').addEventListener('click', () => {
  startQuiz(shuffle(state.wrong));
});
document.getElementById('btnRetryAll').addEventListener('click', () => {
  const pool = poolByCategory();
  startQuiz(shuffle(pool).slice(0, selectedCount));
});
document.getElementById('btnHome').addEventListener('click', () => { renderStartStats(); showScreen('start'); });
document.getElementById('btnHistoryBack').addEventListener('click', () => { renderStartStats(); showScreen('start'); });

/* ================= Init ================= */
renderCatChips();
renderCountChips();
renderStartStats();
