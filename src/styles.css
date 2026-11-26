:root {
  color-scheme: dark;
  --bg: #0b0e11;
  --panel: #12161c;
  --border: #1e2630;
  --text: #e8eef7;
  --muted: #8b9bb4;
  --accent: #22d3ee;
  --green: #22c55e;
  --red: #ef4444;
  --font: "IBM Plex Sans", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
}

button,
input,
select {
  font-family: inherit;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100vh;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: 10px 14px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent);
  margin-right: 6px;
}

.symbol-form {
  display: flex;
  gap: 8px;
  align-items: center;
}

.symbol-form input {
  background: #0b0e11;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 10px;
  min-width: 140px;
  outline: none;
}

.symbol-form input:focus {
  border-color: var(--accent);
}

.symbol-form button,
.interval-btn {
  background: #1a222d;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.symbol-form button:hover,
.interval-btn:hover {
  border-color: var(--accent);
}

.interval-btn.active {
  background: rgba(34, 211, 238, 0.15);
  border-color: var(--accent);
  color: var(--accent);
}

.intervals {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.meta {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.85rem;
}

.meta .up {
  color: var(--green);
}

.meta .down {
  color: var(--red);
}

/* Main workspace with left drawing toolbar */
.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.draw-sidebar {
  width: 46px;
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
  overflow-y: auto;
  user-select: none;
}

.draw-divider {
  width: 24px;
  height: 1px;
  background: var(--border);
  margin: 4px 0;
  flex-shrink: 0;
}

.tool-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.tool-btn:hover {
  background: #1a222d;
  color: var(--text);
}

.tool-btn.active {
  background: rgba(34, 211, 238, 0.15);
  border-color: rgba(34, 211, 238, 0.45);
  color: var(--accent);
}

.tool-btn.long-btn.active {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.5);
  color: var(--green);
}

.tool-btn.short-btn.active {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
  color: var(--red);
}

.tool-btn.danger:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--red);
}

.chart-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.draw-banner {
  background: rgba(34, 211, 238, 0.08);
  border: 1px solid rgba(34, 211, 238, 0.25);
  color: var(--accent);
  font-size: 0.8rem;
  padding: 5px 10px;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chart-panel {
  flex: 1;
  min-height: 320px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  position: relative;
}

.chart-panel.rsi {
  flex: 0 0 140px;
  min-height: 140px;
}

.chart-el {
  width: 100%;
  height: 100%;
}

.status {
  padding: 8px 14px;
  color: var(--muted);
  font-size: 0.85rem;
  border-top: 1px solid var(--border);
}

.status.error {
  color: #fca5a5;
}

.hint {
  color: var(--muted);
  font-size: 0.8rem;
}
