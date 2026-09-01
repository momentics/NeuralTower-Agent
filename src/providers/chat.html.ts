export const chatHtml = `
  <!-- Header -->
  <div id="header">
    <div class="header-left">
      <div class="nt-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <span class="chat-title">NeuralTower</span>
    </div>
    <div class="header-actions">
      <button class="icon-btn" id="btn-new-chat" title="Новый чат">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="icon-btn" id="btn-settings" title="Настройки">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      </button>
    </div>
  </div>

  <!-- Mode bar -->
  <div id="mode-bar">
    <div id="mode-error" class="mode-error"></div>
  </div>

  <!-- Agent state: plan and tasks -->
  <div id="agent-state">
    <details id="plan-panel" class="agent-state-panel" style="display:none">
      <summary>План</summary>
      <div id="plan-body"></div>
    </details>
    <details id="todo-panel" class="agent-state-panel" style="display:none">
      <summary>Задачи</summary>
      <div id="todo-body"></div>
    </details>
  </div>

  <!-- Sessions -->
  <div id="sessions-section">
    <div class="sessions-header">
      <span class="sessions-label">Сессии</span>
      <button class="icon-btn" id="btn-checkpoints" title="Чекпоинты">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </button>
      <button class="icon-btn" id="btn-sessions" title="Все сессии">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div id="sessions-list"></div>
  </div>

  <!-- Messages area -->
  <div id="messages">
    <div id="empty-state">
      <div class="empty-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2a7 7 0 017 7c0 2.5-1.5 4.5-3 6 1.5 1 3 2.5 3 5a7 7 0 01-14 0c0-2.5 1.5-4 3-6-1.5-1.5-3-3.5-3-6a7 7 0 017-7z"/>
          <circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/>
          <path d="M9 13c1 1 5 1 6 0"/>
        </svg>
      </div>
      <div class="empty-title">NeuralTower Agent</div>
      <div class="empty-subtitle">ИИ-ассистент для разработки. Задайте задачу — и агент выполнит её.</div>
      <div class="quick-actions">
        <div class="quick-action" data-text="Исправить баг">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
          Исправить баг
        </div>
        <div class="quick-action" data-text="Объяснить код">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
          Объяснить код
        </div>
        <div class="quick-action" data-text="Написать тесты">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Написать тесты
        </div>
        <div class="quick-action" data-text="Искать в коде">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Искать в коде
        </div>
      </div>
    </div>
  </div>

  <!-- Permission dialog overlay -->
  <div id="perm-overlay" class="perm-overlay">
    <div class="perm-dialog">
      <div class="perm-title">
        <span class="warn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </span>
        Запрос разрешения
      </div>
      <div class="perm-desc" id="perm-desc"></div>
      <div class="perm-actions">
        <button class="perm-btn deny" id="perm-deny">Отклонить</button>
        <button class="perm-btn allow" id="perm-allow">Разрешить</button>
      </div>
    </div>
  </div>

  <!-- Question dialog overlay -->
  <div id="question-overlay" class="perm-overlay" style="display:none">
    <div class="perm-dialog question-dialog">
      <div class="perm-title">
        <span class="info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </span>
        Вопрос агента
      </div>
      <div class="perm-desc" id="question-text"></div>
      <div id="question-options" class="question-options"></div>
      <div class="question-input-row">
        <input id="question-input" type="text" placeholder="Ваш ответ..." autocomplete="off">
        <button class="perm-btn allow" id="question-send" type="button">Ответить</button>
      </div>
    </div>
  </div>

  <!-- Input area -->
  <form id="chat-form">
    <div id="input-area">
      <div id="context-pills" class="context-pills"></div>
      <div id="input-box">
        <textarea id="input" placeholder="Опишите задачу..." rows="1" autocomplete="off"></textarea>
        <div id="input-toolbar">
          <button type="button" class="tb-btn" title="Прикрепить">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <button type="button" class="tb-btn" title="Контекст IDE">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </button>
          <button type="button" class="tb-btn" title="Модель">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </button>
          <div class="tb-spacer"></div>
          <button type="submit" id="send-btn" class="send-btn send" title="Отправить">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
          <button type="button" id="stop-btn" class="send-btn stop" title="Остановить">
            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        </div>
      </div>
    </div>
  </form>

  <!-- Status bar -->
  <div id="status-bar">
    <div class="status-left">
      <div class="status-item">
        <span class="status-dot green" id="status-dot"></span>
        <span id="status-text">Подключено</span>
      </div>
      <div class="status-item" id="status-model"></div>
    </div>
    <div class="status-right">
      <div class="status-item" id="status-mode">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
        Построение
      </div>
    </div>
  </div>`
