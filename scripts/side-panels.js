/* ==========================================================================
 * CoC7-KO | Side Panels  (v0.9.1)
 *
 * The 귓속말 / 노트 tabs used to be injected into the chat sidebar. That
 * approach kept breaking: Foundry re-renders the sidebar on its own schedule
 * and the injected elements were repositioned or detached, so clicks landed
 * only intermittently.
 *
 * These panels are therefore free-floating windows appended to <body> and
 * positioned with `fixed`, exactly like the scene quickbar. They never touch
 * the sidebar DOM, so nothing Foundry does to the sidebar can disturb them.
 * ========================================================================== */

const MODULE_ID = "coc7-ko";

const PANEL_DEFAULTS = {
  whisper: { left: 120, top: 140, width: 400, height: 460 },
  rolls: { left: 120, top: 630, width: 380, height: 320 },
  notes: { left: 560, top: 140, width: 420, height: 480 }
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function setting(key, fallback) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

/** Shared chrome: drag by the header, resize from the bottom-right grip. */
class Coc7KoPanel {
  constructor(key, { id, title, icon }) {
    this.key = key;
    this.id = id;
    this.title = title;
    this.icon = icon;

    this.element = null;
    this._drag = null;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._saveTimer = null;
  }

  get open() {
    return !!this.element?.isConnected;
  }

  placement() {
    const stored = setting("panelPlacement", {})?.[this.key];
    return foundry.utils.mergeObject(
      foundry.utils.deepClone(PANEL_DEFAULTS[this.key]),
      stored ?? {},
      { inplace: false }
    );
  }

  toggle() {
    if (this.open) return this.close();
    return this.render();
  }

  close() {
    this.element?.remove();
    this.element = null;
    this._setVisible(false);
  }

  _setVisible(visible) {
    const state = { ...(setting("panelVisible", {}) ?? {}) };
    state[this.key] = visible;
    game.settings.set(MODULE_ID, "panelVisible", state);
  }

  ensureElement() {
    if (this.element?.isConnected) return this.element;

    const el = document.createElement("section");
    el.id = this.id;
    el.classList.add("coc7ko-floating-panel", "coc7ko-side-panel");

    const placement = this.placement();
    Object.assign(el.style, {
      left: `${placement.left}px`,
      top: `${placement.top}px`,
      width: `${placement.width}px`,
      height: `${placement.height}px`
    });

    document.body.append(el);
    el.addEventListener("pointerdown", this._onPointerDown.bind(this));
    el.addEventListener("click", this._onClick.bind(this));

    this.element = el;
    return el;
  }

  render() {
    const el = this.ensureElement();

    el.innerHTML = `
      <header class="panel-header" data-drag-handle>
        <i class="${this.icon}"></i>
        <span class="panel-title">${escapeHtml(this.title)}</span>
        ${this._headerButtons()}
        <button type="button" class="panel-btn" data-action="close" title="닫기">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </header>
      <div class="panel-body">${this._body()}</div>
      <div class="panel-grip" data-resize-handle title="크기 조정"></div>
    `;

    this._activate(el);
    this._clampIntoView();
    this._setVisible(true);
    return el;
  }

  refresh() {
    if (this.open) this.render();
  }

  /*
   * Replace only the scrolling list, leaving the input box untouched.
   *
   * New messages used to trigger a full re-render, which rebuilt the text
   * box the person was typing in: their text reverted to the last saved
   * draft and the cursor was lost. With several people writing at once,
   * everyone kept knocking everyone else out of the box.
   */
  refreshList(selector) {
    if (!this.open) return;

    const current = this.element.querySelector(selector);
    if (!current) return this.render();

    const holder = document.createElement("div");
    holder.innerHTML = this._body();
    const fresh = holder.querySelector(selector);
    if (!fresh) return;

    // Stay pinned to the newest line only if the reader was already there.
    const atBottom = current.scrollHeight - current.scrollTop - current.clientHeight < 40;
    const previousTop = current.scrollTop;

    current.replaceWith(fresh);
    this._bindList?.(this.element);
    fresh.scrollTop = atBottom ? fresh.scrollHeight : previousTop;
  }

  _headerButtons() {
    return "";
  }

  _body() {
    return "";
  }

  _activate() {}

  async _onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    event.preventDefault();
    if (button.dataset.action === "close") return this.close();

    return this._onAction(button.dataset.action, button, event);
  }

  async _onAction() {}

  /* --- drag / resize ---------------------------------------------------- */

  _onPointerDown(event) {
    if (event.button !== 0) return;

    const resizeHandle = event.target.closest("[data-resize-handle]");
    const dragHandle = event.target.closest("[data-drag-handle]");
    if (!resizeHandle && !dragHandle) return;
    if (event.target.closest("[data-action]")) return;

    const rect = this.element.getBoundingClientRect();
    event.preventDefault();

    this._drag = {
      mode: resizeHandle ? "resize" : "move",
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: rect.height
    };

    this.element.classList.add("dragging");
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (drag.mode === "resize") {
      this.element.style.width = `${Math.max(280, drag.startWidth + dx)}px`;
      this.element.style.height = `${Math.max(200, drag.startHeight + dy)}px`;
      return;
    }

    this.element.style.left = `${Math.max(0, drag.startLeft + dx)}px`;
    this.element.style.top = `${Math.max(0, drag.startTop + dy)}px`;
  }

  _onPointerUp() {
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    if (!this._drag) return;

    this._drag = null;
    this.element?.classList.remove("dragging");
    this._clampIntoView();
    this._savePlacement();
  }

  _clampIntoView() {
    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();

    this.element.style.left = `${Math.round(Math.clamp(rect.left, 0, Math.max(0, window.innerWidth - 100)))}px`;
    this.element.style.top = `${Math.round(Math.clamp(rect.top, 0, Math.max(0, window.innerHeight - 60)))}px`;
  }

  _savePlacement() {
    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();

    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      const all = { ...(setting("panelPlacement", {}) ?? {}) };
      all[this.key] = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      game.settings.set(MODULE_ID, "panelPlacement", all);
    }, 150);
  }
}

/* --- 귓속말 --------------------------------------------------------------- *
 *
 * A tab per conversation partner, so the keeper can hold several private
 * threads at once without retyping /w every time.
 *
 * Who a player may talk to here is a world setting:
 *   "gm"  — players may only whisper the keeper through this panel (default)
 *   "all" — players may whisper each other as well
 * Typing /w by hand is untouched either way; this only governs the panel.
 * ------------------------------------------------------------------------ */

class Coc7KoWhisperPanel extends Coc7KoPanel {
  constructor() {
    super("whisper", {
      id: "coc7ko-whisper-panel",
      title: "귓속말",
      icon: "fa-solid fa-user-secret"
    });
    this.activeTarget = "all";
  }

  /** Users this client may start a whisper thread with, in tab order. */
  partners() {
    const others = game.users.contents.filter(user => user.id !== game.user.id);

    if (game.user.isGM) return others.sort((a, b) => Number(b.isGM) - Number(a.isGM));

    const allowPlayerToPlayer = setting("whisperPolicy", "gm") === "all";
    return others
      .filter(user => user.isGM || allowPlayerToPlayer)
      .sort((a, b) => Number(b.isGM) - Number(a.isGM));
  }

  /** Whispers visible to this client, optionally narrowed to one partner. */
  _messages(partnerId = null) {
    const allowPlayerToPlayer =
      game.user.isGM || setting("whisperPolicy", "gm") === "all";

    return game.messages.contents
      .filter(message => {
        const whisper = message.whisper ?? [];
        if (!whisper.length || !message.visible) return false;

        const author = message.author ?? message.user;
        const involved = new Set([author?.id, ...whisper].filter(Boolean));

        if (!allowPlayerToPlayer) {
          const hasGm = [...involved].some(id => game.users.get(id)?.isGM);
          if (!hasGm) return false;
        }

        if (!partnerId) return true;
        return involved.has(partnerId) && involved.has(game.user.id);
      })
      .slice(-80);
  }

  _headerButtons() {
    return `
      <button type="button" class="panel-btn" data-action="refresh" title="새로고침">
        <i class="fa-solid fa-rotate"></i>
      </button>
    `;
  }

  _body() {
    const partners = this.partners();

    const tabs = [
      `<button type="button" class="wtab ${this.activeTarget === "all" ? "active" : ""}"
               data-action="tab" data-target="all">전체</button>`,
      ...partners.map(user => `
        <button type="button"
                class="wtab ${this.activeTarget === user.id ? "active" : ""}"
                data-action="tab" data-target="${user.id}"
                title="${escapeHtml(user.name)}">
          <span class="dot" style="background:${user.color?.css ?? user.color ?? "#888"}"></span>
          ${escapeHtml(user.name)}${user.isGM ? " (키퍼)" : ""}
        </button>
      `)
    ].join("");

    const partnerId = this.activeTarget === "all" ? null : this.activeTarget;
    const messages = this._messages(partnerId);

    const rows = messages.length
      ? messages.map(message => {
          const author = message.author ?? message.user;
          const alias = message.speaker?.alias || author?.name || "";
          const targets = (message.whisper ?? [])
            .map(id => game.users.get(id)?.name)
            .filter(Boolean)
            .join(", ");

          const div = document.createElement("div");
          div.innerHTML = message.content ?? "";
          const text = (div.textContent ?? "").replace(/\s+/g, " ").trim();

          const mine = author?.id === game.user.id;

          return `
            <article class="whisper-row ${mine ? "mine" : ""}">
              <div class="whisper-meta">
                <strong>${escapeHtml(alias)}</strong>
                <span class="arrow"><i class="fa-solid fa-arrow-right"></i></span>
                <span>${escapeHtml(targets || "?")}</span>
                <time>${new Date(message.timestamp).toLocaleTimeString(game.i18n.lang)}</time>
              </div>
              <div class="whisper-text">${escapeHtml(text) || "<i>(내용 없음)</i>"}</div>
            </article>
          `;
        }).join("")
      : `<p class="hint">주고받은 귓속말이 없습니다.</p>`;

    const canSend = this.activeTarget !== "all";
    const targetName = canSend ? game.users.get(this.activeTarget)?.name ?? "" : "";

    const compose = canSend
      ? `<div class="whisper-compose">
           <input type="text" class="whisper-input"
                  placeholder="${escapeHtml(targetName)}에게 귓속말... (Enter로 전송)">
         </div>`
      : `<p class="hint compose-hint">탭에서 상대를 고르면 바로 귓속말을 보낼 수 있습니다.</p>`;

    return `
      <nav class="whisper-tabs">${tabs}</nav>
      <div class="whisper-list">${rows}</div>
      ${compose}
    `;
  }

  _activate(el) {
    const list = el.querySelector(".whisper-list");
    if (list) list.scrollTop = list.scrollHeight;

    el.querySelector(".whisper-input")?.addEventListener("keydown", async event => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();

      const input = event.currentTarget;
      const content = input.value.trim();
      if (!content || this.activeTarget === "all") return;

      await ChatMessage.implementation.create({
        content,
        whisper: [this.activeTarget, game.user.id]
      });

      input.value = "";
    });
  }

  async _onAction(action, button) {
    if (action === "refresh") return this.refresh();

    if (action === "tab") {
      this.activeTarget = button.dataset.target;
      this.refresh();
      this.element?.querySelector(".whisper-input")?.focus();
    }
  }
}

/* --- 노트 ----------------------------------------------------------------- *
 *
 * Shared, editable, and backed by ChatMessage documents carrying a module
 * flag — exactly like the whisper panel reads ordinary whispers.
 *
 * The previous version kept notes in a world setting, which only a keeper's
 * client may write; a player's entry had to be relayed over a socket and
 * applied by the keeper. That relay failed silently in play. Chat messages
 * need no relay: every player may create one, and Foundry already lets an
 * author update or delete their own, with the keeper able to edit any of
 * them. The permission model we wanted comes for free.
 *
 * These messages are flagged so the chat log hides them; the panel is where
 * they are read.
 * ------------------------------------------------------------------------ */

const NOTE_FLAG = "note";

function noteMessages() {
  return game.messages.contents
    .filter(message => message.getFlag(MODULE_ID, NOTE_FLAG))
    .slice(-200);
}

class Coc7KoNotesPanel extends Coc7KoPanel {
  constructor() {
    super("notes", {
      id: "coc7ko-notes-panel-window",
      title: "노트 (공유)",
      icon: "fa-solid fa-book"
    });
    this._draftTimer = null;
  }

  _headerButtons() {
    return `
      <button type="button" class="panel-btn" data-action="export" title="저널 항목으로 내보내기">
        <i class="fa-solid fa-file-export"></i>
      </button>
      <button type="button" class="panel-btn" data-action="copy" title="전체 복사">
        <i class="fa-solid fa-copy"></i>
      </button>
    `;
  }

  _plainText(message) {
    const div = document.createElement("div");
    div.innerHTML = message.content ?? "";
    return (div.textContent ?? "").trim();
  }

  _body() {
    const entries = noteMessages();
    const draft = game.user.getFlag(MODULE_ID, "noteDraft") ?? "";

    const rows = entries.length
      ? entries.map(message => {
          const author = message.author ?? message.user;
          const editable = message.isAuthor || game.user.isGM;

          return `
            <article class="note-row ${author?.id === game.user.id ? "mine" : ""}"
                     data-message-id="${message.id}">
              <div class="note-meta">
                <strong>${escapeHtml(author?.name ?? "?")}</strong>
                <time>${new Date(message.timestamp).toLocaleString(game.i18n.lang)}</time>
                ${editable ? `<span class="editable" title="우클릭하여 수정"><i class="fa-solid fa-pen"></i></span>` : ""}
              </div>
              <div class="note-text">${escapeHtml(this._plainText(message))}</div>
            </article>
          `;
        }).join("")
      : `<p class="hint">아직 기록이 없습니다. 아래에 입력하고 Enter를 누르세요.</p>`;

    return `
      <div class="note-list">${rows}</div>
      <div class="note-compose">
        <textarea class="note-input"
                  placeholder="모두가 함께 보는 기록장입니다. Enter로 등록, Shift+Enter로 줄바꿈. 내 기록은 우클릭으로 수정·삭제할 수 있습니다.">${escapeHtml(draft)}</textarea>
        <span class="note-status"></span>
      </div>
    `;
  }

  _activate(el) {
    const list = el.querySelector(".note-list");
    if (list) list.scrollTop = list.scrollHeight;

    const input = el.querySelector(".note-input");
    const status = el.querySelector(".note-status");

    // The unsent draft survives a reload; failure here is never fatal.
    input?.addEventListener("input", () => {
      status.textContent = "임시 저장 중...";
      clearTimeout(this._draftTimer);
      this._draftTimer = setTimeout(async () => {
        try {
          await game.user.setFlag(MODULE_ID, "noteDraft", input.value);
          status.textContent = "임시 저장됨";
        } catch (error) {
          console.warn(`${MODULE_ID} | could not save note draft`, error);
          status.textContent = "";
        }
      }, 600);
    });

    input?.addEventListener("keydown", async event => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();

      const text = input.value.trim();
      if (!text) return;

      input.value = "";
      status.textContent = "";

      try {
        await ChatMessage.implementation.create({
          content: foundry.utils.escapeHTML(text).replace(/\n/g, "<br>"),
          flags: { [MODULE_ID]: { [NOTE_FLAG]: true } }
        });
      } catch (error) {
        console.error(`${MODULE_ID} | note create failed`, error);
        input.value = text;
        ui.notifications.error("CoC7-KO | 노트를 등록하지 못했습니다.");
        return;
      }

      try {
        await game.user.unsetFlag(MODULE_ID, "noteDraft");
      } catch (_) {}
    });

    this._bindList(el);
  }

  _bindList(el) {
    el.querySelectorAll(".note-row").forEach(row => {
      row.addEventListener("contextmenu", event => {
        event.preventDefault();
        this._editEntry(row.dataset.messageId);
      });
    });
  }

  async _editEntry(id) {
    const message = game.messages.get(id);
    if (!message) return;

    if (!message.isAuthor && !game.user.isGM) {
      return ui.notifications.warn("CoC7-KO | 다른 사람의 기록은 키퍼만 수정할 수 있습니다.");
    }

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "노트 수정", icon: "fa-solid fa-pen" },
      position: { width: 460 },
      content: `<textarea name="text" style="width:100%;height:160px;">${escapeHtml(this._plainText(message))}</textarea>`,
      buttons: [
        {
          action: "save",
          label: "저장",
          default: true,
          callback: (event, button, dialog) => {
            const root = dialog?.element ?? button?.form ?? button?.closest("dialog");
            return { type: "edit", text: root?.querySelector("[name='text']")?.value ?? "" };
          }
        },
        { action: "delete", label: "삭제", callback: () => ({ type: "delete" }) },
        { action: "cancel", label: "취소" }
      ]
    });

    if (!result || result === "cancel") return;

    try {
      if (result.type === "delete") await message.delete();
      else if (result.text.trim()) {
        await message.update({
          content: foundry.utils.escapeHTML(result.text).replace(/\n/g, "<br>")
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | note edit failed`, error);
      ui.notifications.error("CoC7-KO | 노트를 수정하지 못했습니다.");
    }
  }

  async _onAction(action) {
    const entries = noteMessages();
    const lines = entries.map(message => {
      const author = message.author ?? message.user;
      const time = new Date(message.timestamp).toLocaleString(game.i18n.lang);
      return `[${time}] ${author?.name ?? "?"}: ${this._plainText(message)}`;
    });

    if (action === "copy") {
      await navigator.clipboard?.writeText(lines.join("\n"));
      return ui.notifications.info("CoC7-KO | 노트를 클립보드에 복사했습니다.");
    }

    if (action === "export") {
      if (!game.user.can("JOURNAL_CREATE")) {
        return ui.notifications.warn("CoC7-KO | 저널을 생성할 권한이 없습니다.");
      }

      const paragraphs = entries.map(message => {
        const author = message.author ?? message.user;
        return `<p><strong>${escapeHtml(author?.name ?? "?")}</strong> — ${escapeHtml(this._plainText(message))}</p>`;
      }).join("");

      const journal = await JournalEntry.create({
        name: `공유 노트 (${new Date().toLocaleString(game.i18n.lang)})`,
        pages: [{ name: "노트", type: "text", text: { content: paragraphs } }]
      });

      journal?.sheet?.render(true);
    }
  }
}

/* --- 판정 팔레트 ---------------------------------------------------------- *
 *
 * Favourites built from the CoC7 system's own "링크 생성" dialog.
 *
 * The palette deliberately does not compose check links itself. The system
 * owns that syntax and it changes between releases, so guessing it would put
 * wrong rolls in front of the table. Instead the keeper builds a link with
 * the system dialog, copies it, and pastes it in here once; pressing the
 * button afterwards posts that exact link to chat, where the system renders
 * and resolves it as usual.
 * ------------------------------------------------------------------------ */

/*
 * Drag-and-drop support.
 *
 * The chat link is an <a draggable="true"> the system renders, but a drop
 * event only carries whatever text the browser put on the clipboard — not the
 * element. So the element itself is captured at dragstart, and the drop
 * handler reads it from here. Storing the anchor's own outerHTML means the
 * palette replays exactly what the system produced, with every data attribute
 * intact, rather than trying to rebuild the link syntax.
 */
let lastDraggedLink = null;

document.addEventListener("dragstart", event => {
  const link = event.target?.closest?.(
    "a.coc7-link, a[data-type='CoC7Link'], a[class*='coc7'], .chat-message a[draggable='true']"
  );
  if (!link) return;

  lastDraggedLink = {
    html: link.outerHTML,
    label: (link.textContent ?? "").trim() || "판정"
  };
}, true);

/*
 * Dropped links are stored as the system's own enricher text, e.g.
 *
 *   @coc7.sanloss[sanMin:1,sanMax:1d12,sanReason:신화생물을 만남,difficulty:2]{신화생물을 만남}
 *
 * which is what the "링크 생성" dialog copies to the clipboard. Stored this
 * way an entry stays short, human-editable, and is rendered fresh by the
 * system every time it is posted — rather than replaying a snapshot of
 * rendered HTML.
 *
 * The drag payload uses the rendered link's data-* names, which differ from
 * the enricher's parameter names in two places; those are mapped below.
 * Presentation-only fields are dropped.
 */
const ENRICHER_RENAME = {
  subtype: "type",
  poolModifier: "modifier"
};

const ENRICHER_SKIP = new Set([
  "type", "check", "label", "tooltip", "icon", "cursor", "hasEvents", "enricher"
]);

function coc7EnricherFromData(data) {
  if (!data?.check) return null;

  const params = [];

  for (const [rawKey, rawValue] of Object.entries(data)) {
    if (ENRICHER_SKIP.has(rawKey)) continue;
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;

    const key = ENRICHER_RENAME[rawKey] ?? rawKey;

    // Boolean switches such as `blind` are written as a bare flag.
    if (rawValue === true || rawValue === "true") {
      params.push(key);
      continue;
    }
    if (rawValue === false || rawValue === "false") continue;

    params.push(`${key}:${String(rawValue).replace(/[\],]/g, " ")}`);
  }

  const label = String(data.label || data.name || data.sanReason || "판정").replace(/[{}]/g, "");
  return `@coc7.${data.check}[${params.join(",")}]{${label}}`;
}

/** Reads a rendered link's data-* attributes back into payload form. */
function dataFromLinkElement(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const link = holder.querySelector("a");
  if (!link) return null;

  const data = { ...link.dataset };
  data.label = (link.textContent ?? "").trim();
  return data;
}

class Coc7KoRollPalette extends Coc7KoPanel {
  constructor() {
    super("rolls", {
      id: "coc7ko-roll-palette",
      title: "판정 팔레트",
      icon: "fa-solid fa-dice-d20"
    });
  }

  entries() {
    const stored = setting("rollFavorites", []);
    return Array.isArray(stored) ? stored : [];
  }

  async save(entries) {
    await game.settings.set(MODULE_ID, "rollFavorites", entries);
    this.refresh();
  }

  _headerButtons() {
    return `
      <button type="button" class="panel-btn" data-action="add" title="즐겨찾기 추가">
        <i class="fa-solid fa-plus"></i>
      </button>
    `;
  }

  _body() {
    const entries = this.entries();

    if (!entries.length) {
      return `
        <div class="roll-grid empty">
          <p class="hint">
            채팅에 있는 판정 링크를 <b>이 창으로 끌어다 놓으면</b> 바로 등록됩니다.<br><br>
            또는 시스템의 <b>링크 생성</b> 창에서 <b>클립보드에 복사</b>한 뒤
            위의 <i class="fa-solid fa-plus"></i> 버튼으로 붙여넣어도 됩니다.
          </p>
        </div>
      `;
    }

    return `
      <div class="roll-grid">
        ${entries.map((entry, index) => `
          <button type="button" class="roll-chip" data-action="roll" data-index="${index}"
                  title="${escapeHtml(entry.content)}">
            <i class="${escapeHtml(entry.icon || "fa-solid fa-dice-d20")}"></i>
            <span>${escapeHtml(entry.label)}</span>
          </button>
        `).join("")}
      </div>
      <p class="hint">채팅의 판정 링크를 끌어다 놓아 추가할 수 있습니다. 항목을 우클릭하면 수정·삭제합니다.</p>
    `;
  }

  _activate(el) {
    const grid = el.querySelector(".roll-grid");

    /*
     * One drop zone only. The list sits inside the panel body, so listening on
     * both meant a drop onto the list ran once on the list and again when the
     * event bubbled up to the body — registering every favourite twice.
     */
    const zone = el.querySelector(".panel-body");
    zone?.addEventListener("dragover", event => {
      event.preventDefault();
      grid?.classList.add("drop-target");
    });
    zone?.addEventListener("dragleave", event => {
      if (!zone.contains(event.relatedTarget)) grid?.classList.remove("drop-target");
    });
    zone?.addEventListener("drop", async event => {
      event.preventDefault();
      event.stopPropagation();
      grid?.classList.remove("drop-target");
      await this._acceptDrop(event);
    });

    el.querySelectorAll(".roll-chip").forEach(chip => {
      chip.addEventListener("contextmenu", event => {
        event.preventDefault();
        this._edit(Number(chip.dataset.index));
      });
    });
  }

  /** Registers whatever chat link was just dragged onto the palette. */
  async _acceptDrop(event) {
    const dropped = lastDraggedLink;
    const plain = (event.dataTransfer?.getData("text/plain") ?? "").trim();

    // Prefer the system's JSON payload; fall back to the captured element.
    let data = null;

    if (plain.startsWith("{")) {
      try {
        data = JSON.parse(plain);
      } catch (error) {
        console.warn(`${MODULE_ID} | could not parse dropped link payload`, error);
      }
    }

    if (!data?.check && dropped?.html) data = dataFromLinkElement(dropped.html);

    // Text that is already enricher syntax is stored untouched.
    let content = plain.startsWith("@coc7.") ? plain : coc7EnricherFromData(data);
    const label = data?.label || data?.name || data?.sanReason || dropped?.label || "판정";

    if (!content) {
      return ui.notifications.warn(
        "CoC7-KO | 끌어다 놓은 대상에서 판정 링크를 찾지 못했습니다."
      );
    }

    const entries = this.entries();

    // The same link twice in a row within a moment is a duplicate drop.
    const last = entries[entries.length - 1];
    if (last?.content === content && Date.now() - (this._lastDropAt ?? 0) < 1500) return;
    this._lastDropAt = Date.now();

    entries.push({
      label: label || "판정",
      icon: "fa-solid fa-dice-d20",
      content
    });

    lastDraggedLink = null;
    await this.save(entries);
    ui.notifications.info("CoC7-KO | 판정을 팔레트에 등록했습니다. 우클릭으로 이름과 아이콘을 바꿀 수 있습니다.");
  }

  async _onAction(action, button) {
    if (action === "add") return this._edit(null);

    if (action === "roll") {
      const entry = this.entries()[Number(button.dataset.index)];
      if (!entry) return;

      await ChatMessage.implementation.create({
        content: entry.content,
        speaker: ChatMessage.implementation.getSpeaker()
      });
    }
  }

  async _edit(index) {
    const entries = this.entries();
    const existing = index === null ? { label: "", icon: "fa-solid fa-eye", content: "" } : entries[index];
    if (!existing) return;

    const buttons = [
      { action: "save", label: "저장", default: true, callback: (e, b, d) => ["save", d] },
      { action: "cancel", label: "취소" }
    ];

    if (index !== null) buttons.splice(1, 0, { action: "delete", label: "삭제" });

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: index === null ? "판정 즐겨찾기 추가" : "판정 즐겨찾기 수정" },
      position: { width: 480 },
      content: `
        <div class="coc7ko-roll-form">
          <label>이름</label>
          <input type="text" name="label" value="${escapeHtml(existing.label)}" placeholder="관찰력">

          <label>아이콘 (Font Awesome 클래스)</label>
          <input type="text" name="icon" value="${escapeHtml(existing.icon)}" placeholder="fa-solid fa-eye">

          <label>링크 내용</label>
          <textarea name="content" rows="4"
                    placeholder="시스템의 [링크 생성] 창에서 복사한 내용을 붙여넣으세요">${escapeHtml(existing.content)}</textarea>
        </div>
      `,
      buttons
    });

    if (!result || result === "cancel") return;

    if (result === "delete") {
      entries.splice(index, 1);
      return this.save(entries);
    }

    const [, dialog] = result;
    const root = dialog?.element ?? dialog;
    const read = name => root?.querySelector(`[name='${name}']`)?.value?.trim() ?? "";

    const entry = {
      label: read("label") || "판정",
      icon: read("icon") || "fa-solid fa-dice-d20",
      content: read("content")
    };

    if (!entry.content) {
      return ui.notifications.warn("CoC7-KO | 링크 내용이 비어 있습니다.");
    }

    if (index === null) entries.push(entry);
    else entries[index] = entry;

    return this.save(entries);
  }
}

const panels = {
  whisper: new Coc7KoWhisperPanel(),
  notes: new Coc7KoNotesPanel(),
  rolls: new Coc7KoRollPalette()
};

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "gmSeesPlayerWhispers", {
    name: "플레이어끼리의 귓속말을 키퍼도 보기",
    hint: "켜면 플레이어가 다른 플레이어에게 보내는 귓속말에 키퍼가 수신자로 자동 추가됩니다. 플레이어에게도 수신자 목록에 키퍼가 보이므로 숨김 없이 공개적으로 동작합니다. 끄면 Foundry 기본대로 키퍼도 볼 수 없습니다.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "whisperPolicy", {
    name: "귓속말 창 사용 범위",
    hint: "귓속말 창에서 플레이어가 누구에게 보낼 수 있는지 정합니다. 어느 쪽이든 /w 명령을 직접 입력하는 수동 귓속말은 그대로 가능합니다.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      gm: "플레이어는 키퍼하고만 (기본)",
      all: "플레이어끼리도 허용"
    },
    default: "gm",
    onChange: () => panels.whisper.refresh()
  });

  game.settings.register(MODULE_ID, "rollFavorites", {
    name: "Roll Palette Favorites",
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => panels.rolls.refresh()
  });

  game.settings.register(MODULE_ID, "panelPlacement", {
    name: "Side Panel Placement",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "panelVisible", {
    name: "Side Panel Visibility",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.coc7koPanels = {
    whisper: () => panels.whisper.toggle(),
    notes: () => panels.notes.toggle(),
    rolls: () => panels.rolls.toggle()
  };
});

Hooks.once("ready", () => {
  const visible = setting("panelVisible", {}) ?? {};
  if (visible.whisper) panels.whisper.render();
  if (visible.notes) panels.notes.render();
  if (visible.rolls && game.user.isGM) panels.rolls.render();
});

// Keep the whisper list current without touching the sidebar.
Hooks.on("createChatMessage", message => {
  if (!panels.whisper.open) return;
  if (!(message.whisper ?? []).length) return;
  panels.whisper.refreshList(".whisper-list");
});

Hooks.on("deleteChatMessage", () => {
  if (panels.whisper.open) panels.whisper.refreshList(".whisper-list");
  if (panels.notes.open) panels.notes.refreshList(".note-list");
});

// Notes are chat messages, so the panel follows the same document events.
Hooks.on("createChatMessage", message => {
  if (panels.notes.open && message.getFlag(MODULE_ID, NOTE_FLAG)) panels.notes.refreshList(".note-list");
});

Hooks.on("updateChatMessage", message => {
  if (panels.notes.open && message.getFlag(MODULE_ID, NOTE_FLAG)) panels.notes.refreshList(".note-list");
});

Hooks.on("getSceneControlButtons", controls => {
  const tokenControl = controls.tokens ?? controls.token;
  if (!tokenControl?.tools) return;

  const baseOrder = Object.keys(tokenControl.tools).length + 20;

  tokenControl.tools.coc7koWhisperPanel = {
    name: "coc7koWhisperPanel",
    title: "CoC7-KO | 귓속말 창",
    icon: "fa-solid fa-user-secret",
    order: baseOrder + 1,
    button: true,
    visible: true,
    onChange: () => panels.whisper.toggle()
  };

  tokenControl.tools.coc7koNotesPanel = {
    name: "coc7koNotesPanel",
    title: "CoC7-KO | 공유 노트 창",
    icon: "fa-solid fa-book",
    order: baseOrder + 2,
    button: true,
    visible: true,
    onChange: () => panels.notes.toggle()
  };

  tokenControl.tools.coc7koRollPalette = {
    name: "coc7koRollPalette",
    title: "CoC7-KO | 판정 팔레트",
    icon: "fa-solid fa-dice-d20",
    order: baseOrder + 3,
    button: true,
    visible: game.user.isGM,
    onChange: () => panels.rolls.toggle()
  };
});

/* --- 키퍼의 귓속말 열람 --------------------------------------------------- *
 *
 * Foundry gives keepers no special right to read whispers: a whisper between
 * two players is invisible to the keeper unless the keeper is a recipient.
 * With this setting on, keepers are added as recipients when a player
 * whispers another player — the same thing the "GM Always See Whispers"
 * approach does. It is deliberately visible: players see the keeper in the
 * recipient list, so nothing is read behind their backs.
 *
 * Handled on the author's own client, before the message is created, so it
 * covers /w typed in chat, the whisper panel and whispers from other modules.
 * ------------------------------------------------------------------------ */
Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
  if (userId !== game.user.id) return;
  if (!setting("gmSeesPlayerWhispers", true)) return;

  const author = game.users.get(userId);
  if (!author || author.isGM) return;

  const whisper = Array.from(message.whisper ?? data.whisper ?? []);
  if (!whisper.length) return;

  // A whisper only to oneself (e.g. a self roll) is left private.
  if (!whisper.some(id => id !== userId)) return;

  // Already includes a keeper: nothing to do.
  if (whisper.some(id => game.users.get(id)?.isGM)) return;

  const keepers = game.users.filter(user => user.isGM).map(user => user.id);
  if (!keepers.length) return;

  message.updateSource({ whisper: [...new Set([...whisper, ...keepers])] });
});
