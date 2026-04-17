/**
 * EPL AI Chat UI - Frontend Script
 * 當山式: snake_case / 責務分離 / 意味要素にフック禁止
 */

// ========== ?reset=1 でlocalStorage全クリア（テスト用） ==========
if (new URLSearchParams(location.search).get("reset") === "1") {
  localStorage.clear();
  location.replace(location.pathname);  // パラメータ除去してリロード
}

// ========== Custom Confirm Modal ==========
function show_confirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm_overlay";
    overlay.innerHTML = `
      <div class="confirm_box">
        <p class="confirm_msg">${message}</p>
        <div class="confirm_btns">
          <button class="confirm_btn confirm_ok">OK</button>
          <button class="confirm_btn confirm_cancel">${t("btn_cancel")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector(".confirm_ok").addEventListener("click", () => cleanup(true));
    overlay.querySelector(".confirm_cancel").addEventListener("click", () => cleanup(false));
    overlay.addEventListener("click", e => { if (e.target === overlay) cleanup(false); });
  });
}

// リジェネ選択: "one"(この1人) | "all"(以降全部) | null(キャンセル)
function _show_regen_choice() {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm_overlay";
    overlay.innerHTML = `
      <div class="confirm_box">
        <p class="confirm_msg">${t("regen_choice_msg") || "Regenerate scope?"}</p>
        <div class="confirm_btns" style="flex-direction:column;gap:8px;">
          <button class="confirm_btn confirm_ok" data-val="one" style="width:100%;">🔄 ${t("regen_one") || "This one only"}</button>
          <button class="confirm_btn confirm_ok" data-val="all" style="width:100%;background:#c0392b;">🔄 ${t("regen_all_after") || "This & all after"}</button>
          <button class="confirm_btn confirm_cancel" style="width:100%;">${t("btn_cancel")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelectorAll("[data-val]").forEach(btn => {
      btn.addEventListener("click", () => cleanup(btn.dataset.val));
    });
    overlay.querySelector(".confirm_cancel").addEventListener("click", () => cleanup(null));
    overlay.addEventListener("click", e => { if (e.target === overlay) cleanup(null); });
  });
}

// 3択ダイアログ: "archive" | "delete" | null(キャンセル) を返す
function show_end_confirm() {
  const trash_days = window._trash_retention_days || 15;
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm_overlay";
    overlay.innerHTML = `
      <div class="confirm_box">
        <p class="confirm_msg">${t("end_confirm_archive")}</p>
        <div class="confirm_btns">
          <button class="confirm_btn confirm_ok" id="ec_archive">OK</button>
          <button class="confirm_btn confirm_delete" id="ec_delete">${t("btn_delete")}</button>
          <button class="confirm_btn confirm_cancel" id="ec_cancel">${t("btn_cancel")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector("#ec_archive").addEventListener("click", () => cleanup("archive"));
    overlay.querySelector("#ec_delete").addEventListener("click", () => cleanup("delete"));
    overlay.querySelector("#ec_cancel").addEventListener("click", () => cleanup(null));
    overlay.addEventListener("click", e => { if (e.target === overlay) cleanup(null); });
  });
}

// 入力欄の有効/無効を切り替える
function set_composer_disabled(disabled) {
  const composer = document.getElementById("composer_dock");
  if (composer) composer.style.display = disabled ? "none" : "";
}

// ========== Experience Deduplication ==========
// 同一セッション内で同じ経験通知が複数回表示されるのを防ぐ
const _shown_experience_abstracts = new Set();

// ========== DOM References ==========
const chat_el = document.getElementById("chat");
const input_el = document.getElementById("composer_input");
const btn_send = document.getElementById("btn_send");

// ========== 画像アップロード ==========
let pending_image_base64 = "";
let pending_image_media_type = "image/jpeg";
let pending_image_data_url = "";  // プレビュー用

function init_image_upload() {
  // ファイル選択input（hidden）
  const file_input = document.createElement("input");
  file_input.type = "file";
  file_input.accept = "image/jpeg,image/png,image/gif,image/webp";
  file_input.style.display = "none";
  file_input.id = "image_file_input";
  document.body.appendChild(file_input);

  // ＋ボタン（テキスト入力の左・ChatGPT風）
  const btn_image = document.createElement("button");
  btn_image.id = "btn_image";
  btn_image.title = t("tip_attach_image");
  btn_image.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  btn_image.style.cssText = "background:none;border:1.5px solid #555;border-radius:50%;cursor:pointer;width:30px;height:30px;display:flex;align-items:center;justify-content:center;color:#aaa;padding:0;margin-right:8px;margin-left:4px;flex-shrink:0;align-self:center;transition:border-color 0.2s,color 0.2s;";
  btn_image.addEventListener("mouseenter", () => { btn_image.style.borderColor="#fff"; btn_image.style.color="#fff"; });
  btn_image.addEventListener("mouseleave", () => {
    const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#f90";
    btn_image.style.borderColor = pending_image_base64 ? accent : "#555";
    btn_image.style.color = pending_image_base64 ? accent : "#aaa";
  });
  // テキスト入力の左に挿入（ChatGPTと同じ位置）
  const composer_input_el = document.getElementById("composer_input");
  composer_input_el.parentNode.insertBefore(btn_image, composer_input_el);

  // プレビュー領域
  const preview_div = document.createElement("div");
  preview_div.id = "image_preview_bar";
  preview_div.style.cssText = "display:none;padding:6px 12px;background:#1a1a2e;border-top:1px solid #333;align-items:center;gap:8px;";
  const preview_img = document.createElement("img");
  preview_img.style.cssText = "max-height:60px;max-width:120px;border-radius:6px;";
  const btn_clear = document.createElement("button");
  btn_clear.textContent = "✕";
  btn_clear.style.cssText = "background:none;border:none;color:#aaa;cursor:pointer;font-size:14px;";
  preview_div.appendChild(preview_img);
  preview_div.appendChild(btn_clear);
  const composer = btn_send.closest(".composer") || btn_send.parentNode.parentNode;
  composer.parentNode.insertBefore(preview_div, composer);

  // ボタンクリック → ファイル選択
  btn_image.addEventListener("click", () => file_input.click());

  // ファイル選択後
  file_input.addEventListener("change", () => {
    const file = file_input.files[0];
    if (!file) return;
    set_pending_image_from_file(file);
    file_input.value = "";
  });

  // クリアボタン
  btn_clear.addEventListener("click", () => {
    pending_image_base64 = "";
    pending_image_data_url = "";
    preview_div.style.display = "none";
    btn_image.style.borderColor = "#555";
    btn_image.style.color = "#aaa";
  });

  // Ctrl+V / Cmd+V でクリップボードから画像をペースト
  function set_pending_image_from_file(file) {
    if (!file || !file.type.startsWith("image/")) return false;
    pending_image_media_type = "image/jpeg"; // リサイズ後はJPEGに統一
    const reader = new FileReader();
    reader.onload = (e) => {
      // Canvas でリサイズ（長辺 800px に収める）
      const img_el = new Image();
      img_el.onload = () => {
        const MAX = 800;
        let w = img_el.width, h = img_el.height;
        if (w > MAX || h > MAX) {
          if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
          else        { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img_el, 0, 0, w, h);
        const data_url = canvas.toDataURL("image/jpeg", 0.85);
        pending_image_data_url = data_url;
        pending_image_base64 = data_url.split(",")[1];
        preview_img.src = data_url;
        preview_div.style.display = "flex";
        const _accent = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#f90";
        btn_image.style.borderColor = _accent;
        btn_image.style.color = _accent;
      };
      img_el.src = e.target.result;
    };
    reader.readAsDataURL(file);
    return true;
  }

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (set_pending_image_from_file(file)) {
          e.preventDefault();
          input_el.focus();
          break;
        }
      }
    }
  });

  // ドラッグ＆ドロップ対応
  const chat_area = document.getElementById("chat_area") || document.body;
  ["dragenter", "dragover"].forEach(ev => {
    chat_area.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      chat_area.style.outline = "2px dashed #f90";
    });
  });
  ["dragleave", "dragend"].forEach(ev => {
    chat_area.addEventListener(ev, (e) => {
      e.preventDefault();
      chat_area.style.outline = "";
    });
  });
  chat_area.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    chat_area.style.outline = "";
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) {
      set_pending_image_from_file(file);
      input_el.focus();
    }
  });
}

const btn_end_chat_thread = document.getElementById("btn_end_session");
const btn_memory = document.getElementById("btn_memory");
const title_pill = document.getElementById("title_pill");
/** title_pill にアクター名を表示（show_role_label時は「名前｜役割名」） */
function _set_title_pill(actor_info) {
  if (!actor_info) { title_pill.textContent = t("new_chat_unnamed"); return; }
  const name = actor_info.name || t("new_chat_unnamed");
  if (actor_info.show_role_label && actor_info.role_name) {
    title_pill.textContent = name + "｜" + actor_info.role_name;
  } else {
    title_pill.textContent = name;
  }
}
const engine_badge = document.getElementById("engine_badge");
const init_modal = document.getElementById("init_modal");
const btn_init_submit = document.getElementById("btn_init_submit");
const apikey_modal = document.getElementById("apikey_modal");
const btn_apikey_submit = document.getElementById("btn_apikey_submit");
const immersion_badge = document.getElementById("immersion_badge");
const sidebar_el = document.getElementById("sidebar");
const btn_sidebar_toggle = document.getElementById("btn_sidebar_toggle");
const sidebar_chat_list = document.getElementById("sidebar_chat_list");
const sidebar_more_wrap = document.getElementById("sidebar_more_wrap");
const thread_list_view = document.getElementById("thread_list_view");
const thread_list_body = document.getElementById("thread_list_body");

// ========== Topbar visibility ==========
const _right_group_el = document.querySelector(".right_group");
/**
 * チャット固有ツールの表示制御
 * mode: "chat" = 全表示, "new_chat" = ×だけ無効, "no_chat" = 全非表示
 */
function _set_topbar_mode(mode) {
  if (!_right_group_el) return;
  const help_btn = document.getElementById("btn_help_tutorial");
  if (mode === "no_chat") {
    _right_group_el.classList.add("no_chat");
    btn_end_chat_thread.classList.remove("is_dormant");
    if (help_btn) help_btn.style.display = "none";
  } else if (mode === "new_chat") {
    _right_group_el.classList.remove("no_chat");
    btn_end_chat_thread.classList.add("is_dormant");
    if (help_btn) help_btn.style.display = "";
  } else {
    _right_group_el.classList.remove("no_chat");
    btn_end_chat_thread.classList.remove("is_dormant");
    if (help_btn) help_btn.style.display = "none";
  }
}

// ========== State ==========
let chat_thread_id = "";
let is_sending = false;
let linebreak_mode = "default"; // "default" | "natural"
let transparency_mode = "on"; // "on" | "off"
let imitation_dev_mode = false;
let edit_mode_msg_el = null;   // 編集中のメッセージ要素
let edit_mode_msg_id = null;   // 編集中メッセージのDB ID
let is_multi_mode = false;     // 会議モードかどうか
let multi_participants = [];   // 会議参加者リスト
let multi_conv_mode = "sequential"; // 会話モード: sequential | blind | free | nomination

// 会議モード用の参加者カラーパレット
const MULTI_COLORS = [
  "#10b981", "#f59e0b", "#3b82f6", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

// ========== Meeting Participant Model Lists ==========
// ハードコードモデル一覧（フォールバック）
const _MP_MODELS_FALLBACK = {
  "claude": [
    {id: "claude-haiku-4-5-20251001", label: "Haiku 4.5"},
    {id: "claude-sonnet-4-6", label: "Sonnet 4.6"},
    {id: "claude-opus-4-6", label: "Opus 4.6"},
  ],
  "openai": [
    {id: "gpt-4.1-nano", label: "GPT-4.1 nano"},
    {id: "gpt-4.1-mini", label: "GPT-4.1 mini"},
    {id: "gpt-4.1", label: "GPT-4.1"},
    {id: "gpt-4o-mini", label: "GPT-4o mini"},
    {id: "gpt-4o", label: "GPT-4o"},
  ],
  "gemini": [
    {id: "gemini-2.5-flash-lite", label: "Flash Lite"},
    {id: "gemini-2.5-flash", label: "Flash 2.5"},
    {id: "gemini-2.5-pro", label: "Pro 2.5"},
    {id: "gemini-2.0-flash", label: "Flash 2.0"},
  ],
};
// 動的モデル一覧キャッシュ（APIから取得した結果）
const _MP_MODELS_CACHE = {};
const _MP_MODELS = new Proxy(_MP_MODELS_FALLBACK, {
  get(target, prop) {
    return _MP_MODELS_CACHE[prop] || target[prop] || [];
  }
});
/** エンジンのモデル一覧をAPIから動的取得（キャッシュ付き） */
async function _fetch_mp_models(engine_id) {
  if (_MP_MODELS_CACHE[engine_id]) return _MP_MODELS_CACHE[engine_id];
  try {
    const res = await fetch(`/api/models/${engine_id}`);
    if (res.ok) {
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        // OpenRouterの場合は推奨設定でアイコン付与 + 並べ替え
        if (engine_id === "openrouter") {
          const recommended = await _fetch_openrouter_recommended();
          _MP_MODELS_CACHE[engine_id] = _apply_openrouter_decorations(data.models, recommended);
        } else {
          _MP_MODELS_CACHE[engine_id] = data.models;
        }
        return _MP_MODELS_CACHE[engine_id];
      }
    }
  } catch (e) { console.warn("[MODELS] fetch failed:", e); }
  return _MP_MODELS_FALLBACK[engine_id] || [];
}

/** OpenRouter推奨設定を取得（キャッシュ付き） */
let _openrouter_rec_cache = null;
async function _fetch_openrouter_recommended() {
  if (_openrouter_rec_cache) return _openrouter_rec_cache;
  try {
    const res = await fetch("/api/openrouter/recommended");
    if (res.ok) {
      _openrouter_rec_cache = await res.json();
      return _openrouter_rec_cache;
    }
  } catch (e) { console.warn("[OPENROUTER_REC] fetch failed:", e); }
  return {};
}

/** モデル一覧に推奨設定のアイコンを付与し、並べ替える */
function _apply_openrouter_decorations(models, rec) {
  const epl_picks = rec.epl_picks || [];
  const hot = rec.hot || [];
  const auto = rec.auto_detect || {};
  const free_suffix = auto.free_suffix || ":free";
  const free_icon = auto.free_icon || "🆓";
  const exclude_kws = rec.exclude_keywords || [];

  // ID → 推奨情報マップ
  const pick_map = {};
  epl_picks.forEach(p => pick_map[p.id] = { icon: p.icon || "🔥", note: p.note || "", category: "epl", order: epl_picks.indexOf(p) });
  const hot_map = {};
  hot.forEach(p => hot_map[p.id] = { icon: p.icon || "⚡", note: p.note || "", category: "hot", order: hot.indexOf(p) });

  // フィルタ + デコレーション
  const decorated = [];
  for (const m of models) {
    // exclude_keywordsに一致するものは除外
    const mid = (m.id || "").toLowerCase();
    if (exclude_kws.some(kw => mid.includes(kw.toLowerCase()))) continue;

    const picked = pick_map[m.id];
    const hot_m = hot_map[m.id];
    const is_free = (m.id || "").endsWith(free_suffix);
    let icon = "";
    let category = "other";
    let order = 9999;
    if (picked) { icon = picked.icon; category = "epl"; order = picked.order; }
    else if (hot_m) { icon = hot_m.icon; category = "hot"; order = 1000 + hot_m.order; }
    else if (is_free) { icon = free_icon; category = "free"; order = 2000; }
    decorated.push({
      ...m,
      label: (icon ? icon + " " : "") + m.label,
      _category: category,
      _order: order,
    });
  }
  // 並べ替え: epl_picks → hot → free → その他（カテゴリ内は元のAPI順）
  const cat_order = { epl: 0, hot: 1, free: 2, other: 3 };
  decorated.sort((a, b) => {
    const ca = cat_order[a._category] ?? 9;
    const cb = cat_order[b._category] ?? 9;
    if (ca !== cb) return ca - cb;
    return (a._order || 0) - (b._order || 0);
  });
  return decorated;
}

// ========== Engine Theme Map ==========
const engine_themes = {
  none:   { class: "theme_none",   label: "—",      color: "#aaa" },
  claude: { class: "theme_claude", label: "Claude", color: "#f59e0b" },
  openai: { class: "theme_openai", label: "GPT", color: "#10b981" },
  gemini:     { class: "theme_gemini",     label: "Gemini",     color: "#3b82f6" },
  openrouter: { class: "theme_openrouter", label: "OpenRouter", color: "#e8788a" },
};

// ========== Overlay Badge ==========
let current_ov_info = null;

function update_ov_badge(ov_info) {
  current_ov_info = ov_info || null;
  // 旧バッジ・アイコンは非表示
  const ov_badge = document.getElementById("ov_badge");
  if (ov_badge) ov_badge.style.display = "none";
  const ov_icon = document.getElementById("btn_ov_icon");
  if (ov_icon) ov_icon.style.display = "none";
  // title_pillにオーバーレイ状態を反映（蛍光水色pulse）
  const pill = document.getElementById("title_pill");
  if (pill) {
    if (current_ov_info) {
      pill.classList.add("has_overlay");
      pill.title = t("tip_status_ov").replace("{name}", current_ov_info.name);
    } else {
      pill.classList.remove("has_overlay");
      pill.title = t("tip_status");
    }
  }
}

// オーバーレイアイコンクリック → ステータスモーダル
document.getElementById("btn_ov_icon")?.addEventListener("click", show_status_modal);

// Actor名バッジクリック → ステータスモーダル
document.getElementById("title_pill")?.addEventListener("click", show_status_modal);

// ========== Status Modal ==========
let _sm_temperature = "--";
let _sm_distance = "--";

function show_status_modal() {
  const actor = document.getElementById("title_pill")?.textContent || "--";
  const immersion = document.getElementById("immersion_badge")?.textContent || "--";
  const engine = document.getElementById("engine_badge")?.textContent || "--";
  document.getElementById("sm_actor").textContent = actor;
  document.getElementById("sm_immersion").textContent = immersion;
  document.getElementById("sm_engine").textContent = engine;
  // 温度・距離は開発者モード時のみ表示
  const show_dev = current_dev_flag >= 1 || imitation_dev_mode;
  const sm_temp_row = document.getElementById("sm_temperature_row");
  const sm_dist_row = document.getElementById("sm_distance_row");
  if (sm_temp_row) sm_temp_row.style.display = show_dev ? "flex" : "none";
  if (sm_dist_row) sm_dist_row.style.display = show_dev ? "flex" : "none";
  if (show_dev) {
    document.getElementById("sm_temperature").textContent = _sm_temperature;
    document.getElementById("sm_distance").textContent = _sm_distance;
  }
  const ov_row = document.getElementById("sm_ov_row");
  if (current_ov_info) {
    document.getElementById("sm_ov").textContent = current_ov_info.name || "--";
    ov_row.style.display = "flex";
  } else {
    ov_row.style.display = "none";
  }
  document.getElementById("status_modal").style.display = "flex";
}

function hide_status_modal() {
  document.getElementById("status_modal").style.display = "none";
}

// ========== Immersion Badge ==========
let current_chat_thread_immersion = null;  // セッション没入度の上書き状態

function update_immersion_badge(actor_info, chat_thread_immersion) {
  // chat_thread_immersion引数があればセッション上書き状態を更新
  if (chat_thread_immersion !== undefined) {
    current_chat_thread_immersion = chat_thread_immersion;
  }

  // 表示する没入度を決定（セッション上書き優先）
  const effective = current_chat_thread_immersion != null
    ? current_chat_thread_immersion
    : (actor_info ? actor_info.immersion : null);

  // 本体（immersion 1.0）またはデータなし → 非表示
  if (effective == null || effective >= 1.0) {
    immersion_badge.style.display = "none";
    return;
  }

  immersion_badge.style.display = "";
  immersion_badge.textContent = effective;

  // セッション上書き中は色を変える
  if (current_chat_thread_immersion != null) {
    immersion_badge.title = t("tip_immersion_chat");
    immersion_badge.classList.add("session_override");
  } else {
    immersion_badge.title = t("tip_immersion");
    immersion_badge.classList.remove("session_override");
  }
}

// ========== UMA Temperature Badge (dev_flag >= 1 only) ==========
let current_dev_flag = 0;

function update_uma_badge(uma_temperature) {
  // ヘッダーバッジ（既存）
  let uma_badge = document.getElementById("uma_badge");
  if (!uma_badge) {
    uma_badge = document.createElement("span");
    uma_badge.id = "uma_badge";
    uma_badge.className = "uma_badge";
    const ref = document.getElementById("ov_badge") || immersion_badge;
    ref.parentNode.insertBefore(uma_badge, ref.nextSibling);
  }
  // サイドバーバッジ
  const sb_uma = document.getElementById("sidebar_uma_badge");
  const temp_labels = is_multi_mode ? t("temp_labels_meeting") : t("temp_labels");
  if ((current_dev_flag >= 1 || imitation_dev_mode) && uma_temperature != null) {
    const level = Math.round(Math.min(5, Math.max(0, uma_temperature)));
    const label = `UMA Temp: ${uma_temperature}（${temp_labels[level]}）`;
    uma_badge.style.display = "";
    const uma_icon = uma_temperature >= 4 ? "🔥" : "🌡";
    uma_badge.textContent = uma_icon + uma_temperature;
    uma_badge.title = label;
    if (sb_uma) { sb_uma.textContent = uma_icon + uma_temperature; sb_uma.title = label; sb_uma.style.display = ""; }
    _sm_temperature = `${uma_temperature}（${temp_labels[level]}）`;
  } else {
    uma_badge.style.display = "none";
    if (sb_uma) sb_uma.style.display = "none";
    _sm_temperature = uma_temperature != null ? String(uma_temperature) : "--";
  }
  // 会議モード: 温度4以上で theme_meeting_hot 切り替え
  if (is_multi_mode && uma_temperature != null) {
    if (uma_temperature >= 4) {
      document.body.classList.remove("theme_meeting_even", "theme_meeting_odd");
      document.body.classList.add("theme_meeting_hot");
    } else {
      document.body.classList.remove("theme_meeting_hot");
    }
    const _tpill = document.querySelector(".title_pill");
    if (_tpill) {
      if (uma_temperature >= 4.5) {
        _tpill.classList.add("has_overheat");
      } else {
        _tpill.classList.remove("has_overheat");
      }
    }
  }
  _sync_sidebar_uma_status();
}

// ========== UMA Distance Badge (dev_flag >= 1 only) ==========
function update_distance_badge(uma_distance) {
  let dist_badge = document.getElementById("dist_badge");
  if (!dist_badge) {
    dist_badge = document.createElement("span");
    dist_badge.id = "dist_badge";
    dist_badge.className = "dist_badge";
    const ref = document.getElementById("uma_badge") || document.getElementById("ov_badge") || immersion_badge;
    ref.parentNode.insertBefore(dist_badge, ref.nextSibling);
  }
  const sb_dist = document.getElementById("sidebar_distance_badge");
  const dist_labels = {0: t("dist_labels_0"), 0.3: t("dist_labels_03"), 0.5: t("dist_labels_05"), 0.7: t("dist_labels_07"), 0.9: t("dist_labels_09"), 1: t("dist_labels_1")};
  if ((current_dev_flag >= 1 || imitation_dev_mode) && uma_distance != null) {
    dist_badge.style.display = "";
    dist_badge.textContent = "↔" + uma_distance;
    let label = t("dist_labels_1");
    for (const [threshold, l] of Object.entries(dist_labels).sort((a, b) => a[0] - b[0])) {
      if (uma_distance <= parseFloat(threshold)) { label = l; break; }
    }
    dist_badge.title = t("dist_tooltip").replace("{v}", uma_distance).replace("{l}", label);
    if (sb_dist) { sb_dist.textContent = "↔" + uma_distance; sb_dist.title = dist_badge.title; sb_dist.style.display = ""; }
    _sm_distance = `${uma_distance}（${label}）`;
  } else {
    dist_badge.style.display = "none";
    if (sb_dist) sb_dist.style.display = "none";
    _sm_distance = uma_distance != null ? String(uma_distance) : "--";
  }
  _sync_sidebar_uma_status();
}

function _sync_sidebar_uma_status() {
  const status_el = document.getElementById("sidebar_uma_status");
  if (!status_el) return;
  const sb_uma = document.getElementById("sidebar_uma_badge");
  const sb_dist = document.getElementById("sidebar_distance_badge");
  const has_data = (sb_uma && sb_uma.style.display !== "none") || (sb_dist && sb_dist.style.display !== "none");
  status_el.style.display = has_data ? "flex" : "none";
}

// ========== URL Routing ==========
function get_chat_thread_id_from_url() {
  const match = location.pathname.match(/^\/chat\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function get_actor_key_from_url() {
  const match = location.pathname.match(/^\/actor\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function update_url(sid) {
  const new_path = sid ? `/chat/${sid}` : "/";
  if (location.pathname !== new_path) {
    history.pushState({ chat_thread_id: sid }, "", new_path);
  }
}

function is_threads_url() {
  return location.pathname === "/threads";
}

// ブラウザの戻る・進む対応
window.addEventListener("popstate", (e) => {
  const sid = get_chat_thread_id_from_url();
  if (sid && sid !== chat_thread_id) {
    load_chat_thread(sid);
  }
});

async function update_engine_badge() {
  try {
    const res = await fetch(`/api/model?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
    const data = await res.json();
    const eng = data.engine || "claude";
    const mode = data.model_mode || data.model || "";
    if (eng === "openai") {
      // GPTにはauto機能がないので、autoの場合はベースモデル名を表示
      let short;
      const effective = (mode === "auto" || mode === "auto_full") ? (data.base_model || "gpt-4o") : mode;
      short = effective.includes("mini") ? "mini" : effective.includes("nano") ? "nano" : effective.replace("gpt-", "");
      engine_badge.textContent = `GPT / ${short}`;
    } else if (eng === "gemini") {
      const short = mode.includes("pro") ? "Pro" : mode.includes("2.0") ? "2.0 Flash" : "Flash";
      engine_badge.textContent = `Gemini / ${short}`;
    } else if (eng === "openrouter") {
      // OpenRouter: "provider/model-name" から短縮名を取る
      const short = mode.includes("/") ? mode.split("/")[1].slice(0, 20) : (mode || "—");
      engine_badge.textContent = `OpenRouter / ${short}`;
    } else {
      const short = mode.includes("haiku") ? "Haiku" : mode.includes("opus") ? "Opus" : mode.includes("auto") ? "auto" : "Sonnet";
      engine_badge.textContent = `Claude / ${short}`;
    }
    // 新規チャット画面中はアクター選択UIが色を制御するのでスキップ
    if (!document.querySelector(".new_chat_screen")) {
      document.body.classList.remove("send_engine_claude", "send_engine_openai", "send_engine_gemini", "send_engine_openrouter");
      document.body.classList.add(
        eng === "openai" ? "send_engine_openai"
        : eng === "gemini" ? "send_engine_gemini"
        : eng === "openrouter" ? "send_engine_openrouter"
        : "send_engine_claude"
      );
      const theme = engine_themes[eng] || engine_themes.claude;
      document.body.classList.remove("theme_none", "theme_claude", "theme_openai", "theme_gemini", "theme_openrouter");
      document.body.classList.add(theme.class);
      const _eng_label = eng === "openai" ? "GPT" : eng === "gemini" ? "Gemini" : eng === "openrouter" ? "OpenRouter" : "Claude";
      input_el.placeholder = `Ask Epel (${_eng_label})`;
      update_memory_layer_panel();
    }
  } catch (_) {}
}

// ========== Init ==========
async function init_app() {
  try {
    // URLからchat_thread_idを取得してサーバーに渡す（マルチタブ安全）
    const _url_tid = get_chat_thread_id_from_url() || "";
    const res = await fetch(`/api/config?chat_thread_id=${encodeURIComponent(_url_tid)}`);
    const data = await res.json();

    chat_thread_id = data.chat_thread_id || "";
    window._trash_retention_days = data.trash_retention_days || 15;

    // エンジンテーマ設定（engine_ready=false なら none テーマ）
    const _eid = data.engine_ready ? data.engine : "none";
    const theme = engine_themes[_eid] || engine_themes.none;
    document.body.classList.remove("theme_none", "theme_claude", "theme_openai", "theme_gemini");
    document.body.classList.add(theme.class);
    document.body.classList.remove("send_engine_claude", "send_engine_openai", "send_engine_gemini", "send_engine_openrouter");
    if (data.engine_ready) {
      document.body.classList.add(data.engine === "openai" ? "send_engine_openai" : data.engine === "gemini" ? "send_engine_gemini" : "send_engine_claude");
    }
    engine_badge.textContent = data.engine_ready ? theme.label : "none / none";
    input_el.placeholder = data.engine_ready ? `Ask Epel (${theme.label})` : "...";
    if (data.engine_ready) update_engine_badge();

    // 設定読み込み
    await load_linebreak_mode();
    await load_transparency_mode();
    await load_imitation_dev_mode();

    // ?setup パラメータで強制的に初回画面を表示（デモ・確認用）
    const _force_setup = new URLSearchParams(location.search).has("setup");
    if (!data.engine_ready || _force_setup) {
      // 初回起動: 言語選択 → APIキー設定の順
      if (!_show_lang_modal_if_needed()) {
        show_apikey_modal();
      }
      return;
    }

    // アクター名をタイトルに表示
    if (data.actor_info) {
      _set_title_pill(data.actor_info);
    }
    update_immersion_badge(data.actor_info);
    update_ov_badge(data.ov_info);
    current_dev_flag = data.dev_flag || 0;
    update_uma_badge(data.uma_temperature);
    update_distance_badge(data.uma_distance);

    // Init Activation Event チェック
    if (!data.has_personal) {
      show_init_modal();
    } else {
      // URLに actor_key があればアクター切替
      const url_actor_key = get_actor_key_from_url();
      if (url_actor_key) {
        const switch_res = await fetch(`/api/actor/switch_by_key/${url_actor_key}`, { method: "POST" });
        const switch_data = await switch_res.json();
        if (switch_res.ok) {
          _set_title_pill(switch_data.actor_info);
          update_immersion_badge(switch_data.actor_info);
          chat_thread_id = switch_data.chat_thread_id;
          add_system_message(t("start_chat"));
          update_url(chat_thread_id);
          update_memory_layer_panel();
        }
      } else if (is_threads_url()) {
        // /threads → スレッド一覧を表示
        // データが必要なので load_sidebar_chats を先に待つ
        await load_sidebar_chats();
        show_thread_list_view();
      } else if (location.pathname === "/knowledge") {
        // /knowledge → ナレッジ管理画面を表示
        show_knowledge_view();
      } else if (location.pathname === "/datasource") {
        // /datasource → データソース管理画面を直接表示
        show_knowledge_view();
        _salvage_show_view();
      } else {
        // URLにchat_thread_idがあればそのセッションを読み込む
        const url_chat_thread = get_chat_thread_id_from_url();
        if (url_chat_thread) {
          await load_chat_thread(url_chat_thread);
        } else if (location.pathname === "/") {
          // トップページ = 新規チャット画面
          await show_new_chat_screen();
          // ?action パラメータがあればモーダル表示
          const _params = new URLSearchParams(location.search);
          if (_params.get("action") === "new_actor") {
            show_init_modal("actor");
            history.replaceState({}, "", "/");
          } else if (_params.get("action") === "new_personal") {
            show_init_modal("personal");
            history.replaceState({}, "", "/");
          } else if (_params.get("action") === "replay_unlock") {
            // 秘密のURL: 会議解放通知をもう一度見る
            localStorage.removeItem("meeting_unlocked_seen");
            history.replaceState({}, "", "/");
            await _check_meeting_button_visibility();
          }
        } else {
          add_system_message(t("start_chat"));
          update_url(chat_thread_id);
        }
      }
    }
  } catch (e) {
    add_system_message(t("server_error"));
    console.error("Init error:", e);
  }
}

// ========== Language Selection Modal (first launch) ==========
function _show_lang_modal_if_needed() {
  // ?setup パラメータで強制表示（開発・デモ用）
  const _force_setup = new URLSearchParams(location.search).has("setup");
  // 言語未選択（初回起動）の場合、または ?setup 指定の場合
  if (!_force_setup && localStorage.getItem("epl_lang")) return false;
  // Welcome splash → Language selection → API key
  const welcome = document.getElementById("welcome_modal");
  const lang = document.getElementById("lang_modal");
  if (!welcome || !lang) return false;
  welcome.style.display = "flex";
  document.getElementById("btn_welcome_start")?.addEventListener("click", () => {
    welcome.style.display = "none";
    lang.style.display = "flex";
  });
  document.getElementById("btn_lang_ja")?.addEventListener("click", () => {
    localStorage.setItem("epl_lang", "ja");
    lang.style.display = "none";
    if (typeof apply_i18n === "function") apply_i18n("ja");
    show_apikey_modal();
  });
  document.getElementById("btn_lang_en")?.addEventListener("click", () => {
    localStorage.setItem("epl_lang", "en");
    lang.style.display = "none";
    if (typeof apply_i18n === "function") apply_i18n("en");
    show_apikey_modal();
  });
  return true;
}

// ========== API Key Modal ==========
function show_apikey_modal() {
  apikey_modal.style.display = "flex";
  btn_send.disabled = true;
}

function hide_apikey_modal() {
  apikey_modal.style.display = "none";
  btn_send.disabled = false;
}

async function _apply_api_key_result(data, engine_type) {
  hide_apikey_modal();
  const _eng = data.engine || engine_type;
  const theme = engine_themes[_eng] || engine_themes.claude;
  document.body.className = "";
  document.body.classList.add(theme.class);
  document.body.classList.add(_eng === "openai" ? "send_engine_openai" : _eng === "gemini" ? "send_engine_gemini" : "send_engine_claude");
  engine_badge.textContent = data.engine_name || theme.label;
  input_el.placeholder = `Ask Epel (${data.engine_name || theme.label})`;
  add_system_message(t("ak_connected").replace("{name}", data.engine_name));
  // 初回セットアップ: localStorage未完了 or 人格0人 → はじめましてモーダル
  await _check_and_show_init_if_needed();
}

async function _check_and_show_init_if_needed() {
  // localStorage にセットアップ完了フラグがあればスキップ
  if (localStorage.getItem("epl_setup_done")) return;
  try {
    const config_res = await fetch(`/api/config?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
    const config_data = await config_res.json();
    if (!config_data.has_personal) {
      show_init_modal();
    } else {
      // 人格がある = セットアップ済み
      localStorage.setItem("epl_setup_done", "1");
      add_system_message(t("start_chat"));
    }
  } catch (e) {
    console.error("init check failed:", e);
    show_init_modal();  // 失敗時も安全側に倒す
  }
}

function update_apikey_status() {
  const engine_type = document.getElementById("apikey_engine").value;
  const status_el = document.getElementById("apikey_status");
  if (!status_el) return;
  // DBに保存済みかどうかの表示（サーバーに問い合わせる方法がないので簡易表示）
  status_el.textContent = t("apikey_save_note");
}

document.getElementById("apikey_engine").addEventListener("change", update_apikey_status);

btn_apikey_submit.addEventListener("click", async () => {
  const api_key = document.getElementById("apikey_input").value.trim();
  const status_el = document.getElementById("apikey_status");
  if (!api_key) {
    status_el.textContent = t("ak_enter_key");
    status_el.style.color = "#e74c3c";
    return;
  }
  const engine_type = document.getElementById("apikey_engine").value;
  // ローディング表示
  status_el.textContent = t("ak_validating") || "Validating...";
  status_el.style.color = "#aaa";
  btn_apikey_submit.disabled = true;
  try {
    const res = await fetch("/api/set_api_key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: api_key, engine: engine_type }),
    });
    const data = await res.json();
    if (res.ok) {
      status_el.textContent = "";
      await _apply_api_key_result(data, engine_type);
    } else {
      status_el.textContent = t(data.error) || data.error || t("ak_save_fail");
      status_el.style.color = "#e74c3c";
    }
  } catch (e) {
    status_el.textContent = t("net_error");
    status_el.style.color = "#e74c3c";
    console.error("API key error:", e);
  } finally {
    btn_apikey_submit.disabled = false;
  }
});

document.getElementById("btn_apikey_reset").addEventListener("click", async () => {
  const engine_type = document.getElementById("apikey_engine").value;
  if (!await show_confirm(t("ak_reset_confirm").replace("{engine}", engine_type))) return;
  try {
    const res = await fetch(`/api/set_api_key/${engine_type}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      alert(t("ak_reset_done"));
      hide_apikey_modal();
    } else {
      alert(data.error || t("ak_reset_fail"));
    }
  } catch (e) {
    alert(t("net_error"));
  }
});

// ========== Init Modal ==========
let init_mode = "personal"; // "personal" or "actor"
let init_target_personal_id = null; // actorモード時の所属Personal

// アクタータイプ: "persona" | "mode" | null(personal作成時)
let init_actor_type = null;

async function show_init_modal(mode, target_personal_id) {
  init_mode = mode || "personal";
  init_target_personal_id = target_personal_id || null;
  init_actor_type = null;

  const modal_title = document.querySelector("#init_modal .modal_title");
  const subtitle = document.querySelector("#init_modal .modal_desc");
  const chooser = document.getElementById("actor_type_chooser");
  const form = document.querySelector("#init_modal .init_form");

  // actorモード: Personal一覧取得 & Personal名解決
  let _personal_name = "";
  const personal_row = document.getElementById("init_personal_row");
  const personal_select = document.getElementById("init_personal");
  if (init_mode === "actor") {
    try {
      const res = await fetch("/api/personal/list");
      const data = await res.json();
      const personals = data.personals || [];
      if (personals.length > 1) {
        personal_select.innerHTML = "";
        personals.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.personal_id;
          opt.textContent = p.name || t("new_chat_unnamed");
          personal_select.appendChild(opt);
        });
        if (init_target_personal_id) {
          personal_select.value = init_target_personal_id;
        }
        personal_row.style.display = "";
      } else {
        personal_row.style.display = "none";
        if (personals.length === 1) init_target_personal_id = personals[0].personal_id;
      }
      // Personal名を取得
      const _target = personals.find(p => p.personal_id == init_target_personal_id);
      _personal_name = _target?.name || personals[0]?.name || "";
    } catch (e) {
      personal_row.style.display = "none";
    }
  } else {
    personal_row.style.display = "none";
  }

  // エンジン色をモーダルに反映
  let _modal_engine = "";
  if (init_mode === "actor" && init_target_personal_id) {
    const _eng_btn = document.querySelector(`.new_chat_engine_btn[data-pid="${init_target_personal_id}"]`);
    _modal_engine = _eng_btn?.dataset.engine || "";
  }
  init_modal.classList.remove("is_engine_claude", "is_engine_openai", "is_engine_gemini");
  if (_modal_engine) {
    init_modal.classList.add(_modal_engine === "openai" ? "is_engine_openai" : _modal_engine === "gemini" ? "is_engine_gemini" : "is_engine_claude");
  }

  // actorモード → タイプ選択を表示、フォームは隠す
  if (init_mode === "actor") {
    const _n = _personal_name || t("new_chat_unnamed");
    if (modal_title) modal_title.textContent = t("init_title_actor");
    if (subtitle) subtitle.textContent = t("actor_type_title").replace("{name}", _n);
    document.getElementById("actor_type_desc").textContent = t("actor_type_desc");
    document.getElementById("actor_type_persona_label").textContent = t("actor_type_persona");
    document.getElementById("actor_type_persona_desc").textContent = t("actor_type_persona_desc").replace(/\{name\}/g, _n);
    document.getElementById("actor_type_mode_label").textContent = t("actor_type_mode");
    document.getElementById("actor_type_mode_desc").textContent = t("actor_type_mode_desc").replace(/\{name\}/g, _n);
    chooser.style.display = "";
    form.style.display = "none";
  } else {
    if (modal_title) modal_title.textContent = t("init_title");
    if (subtitle) subtitle.textContent = t("init_desc");
    chooser.style.display = "none";
    form.style.display = "";
    // personalモード: 全項目表示
    _show_all_init_fields();
  }

  // 初回セットアップ時は×ボタン非表示（逃げられない）、2人目以降は表示
  const btn_close = document.getElementById("btn_init_close");
  if (btn_close) {
    btn_close.style.display = localStorage.getItem("epl_setup_done") ? "" : "none";
  }
  _init_switch_tab("basic");
  if (init_mode === "personal") _init_arrange_fields("personal");
  init_modal.style.display = "flex";
}

// アクタータイプ選択後 → フォーム表示
function _select_actor_type(type) {
  init_actor_type = type;
  const chooser = document.getElementById("actor_type_chooser");
  const form = document.querySelector("#init_modal .init_form");
  const subtitle = document.querySelector("#init_modal .modal_desc");
  chooser.style.display = "none";
  form.style.display = "";

  // フィールドの表示/非表示を制御
  const name_row = document.getElementById("init_name").closest(".form_row");
  const pronoun_row = document.getElementById("init_pronoun").closest(".form_row");
  const reason_row = document.getElementById("init_reason").closest(".form_row");
  const specialty_row = document.getElementById("init_specialty").closest(".form_row");

  if (type === "persona") {
    if (subtitle) subtitle.textContent = t("init_new_actor");
    _init_arrange_fields("actor_persona");
  } else {
    if (subtitle) subtitle.textContent = t("actor_type_mode");
    _init_arrange_fields("actor_mode");
  }
}

// 全init_formフィールドを表示
function _show_all_init_fields() {
  const ids = ["init_name", "init_pronoun", "init_reason", "init_specialty"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.closest(".form_row").style.display = "";
  });
}

// タイプ選択ボタンのイベント
document.getElementById("actor_type_persona")?.addEventListener("click", () => _select_actor_type("persona"));
document.getElementById("actor_type_mode")?.addEventListener("click", () => _select_actor_type("mode"));

function hide_init_modal() {
  init_modal.style.display = "none";
  // リセット: 次回表示時にタイプ選択から始まるように
  init_actor_type = null;
  const chooser = document.getElementById("actor_type_chooser");
  const form = document.querySelector("#init_modal .init_form");
  if (chooser) chooser.style.display = "none";
  if (form) form.style.display = "";
  _show_all_init_fields();
}

// モード別フィールド配置（人格 / アクター名前 / アクター役割モード）
function _init_arrange_fields(mode) {
  // mode: "personal" | "actor_persona" | "actor_mode"
  const $ = id => document.getElementById(id);
  const show = (id, v) => { const el = $(id); if (el) el.style.display = v ? "" : "none"; };
  const move = (row_id, tab_id) => {
    const row = $(row_id);
    const tab = $(tab_id);
    if (row && tab && row.parentElement !== tab) tab.appendChild(row);
  };

  // --- 全行をデフォルト表示 ---
  document.querySelectorAll("#init_modal .form_row").forEach(r => r.style.display = "");

  // 役割ラベル切り替え
  const _role_label = $("init_row_role")?.querySelector("[data-i18n]");
  if (_role_label) {
    const is_actor = mode !== "personal";
    _role_label.setAttribute("data-i18n", is_actor ? "init_role_actor" : "init_role");
    _role_label.textContent = t(is_actor ? "init_role_actor" : "init_role") || (is_actor ? "役割（ロール）又はモード" : "役割（ロール）");
  }

  if (mode === "personal") {
    // 人格: ベース人格=非表示、名前=表示、役割=任意、持ち帰り=非表示
    show("init_personal_row", false);
    show("init_row_role_detail", false);
    show("init_row_carryback", false);
    // 得意なこと・大事にしていること → タブ2
    move("init_row_specialty", "init_tab_personality");
    move("init_row_core_message", "init_tab_personality");
    // 名前の由来 → タブ2に表示
    show("init_row_reason", true);
    // 役割の注釈を表示
    const note = document.querySelector(".init_role_note");
    if (note) note.style.display = "";

  } else if (mode === "actor_persona") {
    // アクター（名前）: 対象人格=表示、名前=表示、役割=必須
    show("init_personal_row", true);
    show("init_row_role_detail", false);
    show("init_row_carryback", true);
    // 持ち帰り初期値=1
    _init_set_carryback(1);
    // 得意なこと・大事にしていること → タブ2
    move("init_row_specialty", "init_tab_personality");
    move("init_row_core_message", "init_tab_personality");
    // 役回りの補足 → タブ2
    show("init_row_role_detail", true);
    move("init_row_role_detail", "init_tab_personality");
    // 名前の由来 → 非表示（アクターには不要）
    show("init_row_reason", false);
    // 役割の注釈を非表示（アクターでは役割が主役寄り）
    const note = document.querySelector(".init_role_note");
    if (note) note.style.display = "none";
    // show_role_label デフォルトON
    const srl = $("init_show_role_label");
    if (srl) srl.checked = true;

  } else if (mode === "actor_mode") {
    // アクター（役割・モード）: 名前=非表示、役割=主役
    show("init_personal_row", true);
    show("init_row_name", false);
    show("init_row_pronoun", false);
    show("init_row_reason", false);
    show("init_row_carryback", true);
    // show_role_label → 非表示（内部自動ON）
    show("init_row_show_role", false);
    const srl = $("init_show_role_label");
    if (srl) srl.checked = true;
    // 持ち帰り初期値=3
    _init_set_carryback(3);
    // 役回りの補足・得意なこと・大事にしていること → タブ1
    show("init_row_role_detail", true);
    move("init_row_role_detail", "init_tab_basic");
    move("init_row_specialty", "init_tab_basic");
    move("init_row_core_message", "init_tab_basic");
    // 性別 → 非表示（モードでは不要）
    show("init_row_gender", false);
    // 役割の注釈を非表示
    const note = document.querySelector(".init_role_note");
    if (note) note.style.display = "none";
    // 名前をクリア
    $("init_name").value = "";
  }
}

// タブ切り替え
function _init_switch_tab(tab_name) {
  document.querySelectorAll("#init_modal .init_tab_btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab_name);
  });
  document.querySelectorAll("#init_modal .init_tab_content").forEach(tc => {
    tc.style.display = tc.id === "init_tab_" + tab_name ? "" : "none";
  });
}
document.querySelectorAll("#init_modal .init_tab_btn").forEach(btn => {
  btn.addEventListener("click", () => _init_switch_tab(btn.dataset.tab));
});

// 持ち帰りレベルの初期値設定ヘルパー
function _init_set_carryback(level) {
  const radios = document.querySelectorAll('input[name="init_carryback_level"]');
  radios.forEach(r => r.checked = r.value === String(level));
}

// 文字数カウンター: maxlength付きinputにリアルタイム表示
for (const id of ["init_name", "init_pronoun", "init_traits", "init_reason", "init_specialty", "init_appearance", "init_extra", "init_owner_call", "init_role", "init_role_detail", "init_tone_custom", "init_ending_style", "init_background", "init_advanced"]) {
  const input = document.getElementById(id);
  const counter = document.getElementById(`cc_${id}`);
  if (!input || !counter) continue;
  const max = parseInt(input.getAttribute("maxlength") || "0");
  if (!max) continue;
  const update = () => {
    const len = input.value.length;
    counter.textContent = len > 0 ? `(${len}/${max})` : "";
    counter.classList.toggle("near_limit", len >= max * 0.8 && len < max);
    counter.classList.toggle("at_limit", len >= max);
  };
  input.addEventListener("input", update);
  update(); // 初期値があるフィールド用（一人称の「わたし」等）
}

// 性別・種族「その他」選択時にカスタム入力を表示
document.getElementById("init_gender")?.addEventListener("change", (e) => {
  const custom = document.getElementById("init_gender_custom");
  if (custom) custom.style.display = e.target.value === "_other" ? "" : "none";
});
document.getElementById("init_species")?.addEventListener("change", (e) => {
  const custom = document.getElementById("init_species_custom");
  if (custom) custom.style.display = e.target.value === "_other" ? "" : "none";
});
document.getElementById("init_role_select")?.addEventListener("change", (e) => {
  const custom = document.getElementById("init_role");
  if (custom) custom.style.display = e.target.value === "_other" ? "" : "none";
});
document.getElementById("init_pronoun_select")?.addEventListener("change", (e) => {
  const custom = document.getElementById("init_pronoun");
  if (custom) custom.style.display = e.target.value === "_other" ? "" : "none";
});
document.getElementById("init_tone")?.addEventListener("change", (e) => {
  const custom = document.getElementById("init_tone_custom");
  if (custom) custom.style.display = e.target.value === "_other" ? "" : "none";
});
document.getElementById("init_ending_select")?.addEventListener("change", (e) => {
  const custom = document.getElementById("init_ending_style");
  if (custom) custom.style.display = e.target.value === "_other" ? "" : "none";
});
document.getElementById("init_base_lang")?.addEventListener("change", (e) => {
  const custom = document.getElementById("init_base_lang_custom");
  if (custom) custom.style.display = e.target.value === "_other" ? "" : "none";
});

btn_init_submit.addEventListener("click", async () => {
  const _is_mode_type = (init_mode === "actor" && init_actor_type === "mode");

  // 専門モード: 得意なこと必須チェック
  if (_is_mode_type) {
    const specialty_val = document.getElementById("init_specialty")?.value.trim() || "";
    if (!specialty_val) {
      const err = document.getElementById("init_error");
      if (err) { err.textContent = t("init_specialty") + " is required"; err.style.display = ""; }
      return;
    }
  }

  const raw_name = _is_mode_type ? "" : document.getElementById("init_name").value.trim();
  const is_unnamed = !raw_name;
  const name = raw_name || t("default_actor_name");

  const traits_raw = document.getElementById("init_traits").value.trim();
  const traits = traits_raw ? traits_raw.split(/[,，、]/).map(t => t.trim()).filter(Boolean) : [];

  // セレクト値の取得ヘルパー（_other時はカスタム入力を使う）
  const _sel = (sel_id, custom_id) => {
    const v = document.getElementById(sel_id)?.value || "";
    return (v === "_other" || v === "_free") ? (document.getElementById(custom_id)?.value.trim() || "") : v;
  };

  const body = {
    name: name,
    pronoun: _sel("init_pronoun_select", "init_pronoun") || (_is_mode_type ? "" : t("init_pronoun_default")),
    gender: _sel("init_gender", "init_gender_custom"),
    species: _sel("init_species", "init_species_custom"),
    traits: traits,
    naming_reason: is_unnamed ? "" : document.getElementById("init_reason")?.value.trim() || "",
    specialty: document.getElementById("init_specialty")?.value.trim() || "",
    appearance: document.getElementById("init_appearance")?.value.trim() || "",
    extra_attributes: document.getElementById("init_extra")?.value.trim() || "",
    is_unnamed: is_unnamed,
    lang: get_lang(),
    base_lang: _sel("init_base_lang", "init_base_lang_custom"),
    // 8代目追加: 新フィールド
    tone: _sel("init_tone", "init_tone_custom"),
    tone_custom: document.getElementById("init_tone_custom")?.value.trim() || "",
    ending_style: _sel("init_ending_select", "init_ending_style"),
    owner_call: document.getElementById("init_owner_call")?.value.trim() || "",
    role: _sel("init_role_select", "init_role"),
    show_role_label: document.getElementById("init_show_role_label")?.checked || false,
    role_detail: document.getElementById("init_role_detail")?.value.trim() || "",
    background: document.getElementById("init_background")?.value.trim() || "",
    advanced: document.getElementById("init_advanced")?.value.trim() || "",
    carryback_level: parseInt(document.querySelector('input[name="init_carryback_level"]:checked')?.value || "1"),
    carryback_note: document.getElementById("init_carryback_note")?.value.trim() || "",
  };

  // actorモード: 所属Personalを決定
  if (init_mode === "actor") {
    const personal_row = document.getElementById("init_personal_row");
    const personal_select = document.getElementById("init_personal");
    if (personal_row.style.display !== "none" && personal_select.value) {
      body.personal_id = parseInt(personal_select.value);
    } else if (init_target_personal_id) {
      body.personal_id = init_target_personal_id;
    }
    // アクタータイプを送信
    if (init_actor_type) body.actor_type = init_actor_type;
  }

  const api_url = init_mode === "actor" ? "/api/actor/create" : "/api/init";

  try {
    const res = await fetch(api_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (res.ok) {
      // オンボーディング吹き出し消去
      if (init_mode === "actor") localStorage.setItem("ob_actor_seen", "1");
      // 人格は「2人目以降を作った時」に消す（初回作成時はバルーンをまだ見せたい）
      const _already_setup = localStorage.getItem("epl_setup_done") === "1";
      if (init_mode === "personal" && _already_setup) {
        localStorage.setItem("ob_personal_seen", "1");
      }
      localStorage.setItem("epl_setup_done", "1");
      hide_init_modal();
      // チャット画面をクリアして新しいセッションに移動
      chat_el.innerHTML = "";
      // アクター名を表示（show_role_label対応）
      _set_title_pill(data.actor_info);
      // URLとchat_thread_idを更新（新セッション）
      if (data.chat_thread_id) {
        chat_thread_id = data.chat_thread_id;
        window.history.pushState({}, "", "/chat/" + data.chat_thread_id);
      }
      // エンジン色・没入度を更新
      await update_engine_badge();
      if (data.actor_info) {
        update_immersion_badge(data.actor_info);
      }
      if (init_mode === "actor") {
        add_system_message(t("actor_born").replace("{name}", name));
      } else if (is_unnamed) {
        add_system_message(t("actor_born_default"));
      } else {
        add_system_message(t("actor_born_personal").replace("{name}", name));
      }
      // Birth Scene: AIの最初の一言を表示
      if (data.first_message) {
        add_message("assistant", data.first_message);
      }
      // フォームをリセット
      document.getElementById("init_name").value = "";
      document.getElementById("init_pronoun").value = t("init_pronoun_default");
      document.getElementById("init_gender").value = "";
      const _gc = document.getElementById("init_gender_custom"); if (_gc) { _gc.value = ""; _gc.style.display = "none"; }
      if (document.getElementById("init_species")) document.getElementById("init_species").value = "";
      const _sc = document.getElementById("init_species_custom"); if (_sc) { _sc.value = ""; _sc.style.display = "none"; }
      document.getElementById("init_traits").value = "";
      document.getElementById("init_reason").value = "";
      if (document.getElementById("init_specialty")) document.getElementById("init_specialty").value = "";
      if (document.getElementById("init_appearance")) document.getElementById("init_appearance").value = "";
      if (document.getElementById("init_extra")) document.getElementById("init_extra").value = "";
      if (document.getElementById("init_base_lang")) document.getElementById("init_base_lang").value = "";
      hide_init_error();
      // チャット一覧を更新 + 会議ボタン再チェック
      await load_sidebar_chats();
      _check_meeting_button_visibility();
    } else {
      show_init_error(data.error || t("init_error"));
    }
  } catch (e) {
    show_init_error(t("init_comm_error"));
    console.error("Init error:", e);
  }
});

function show_init_error(msg) {
  const el = document.getElementById("init_error");
  el.textContent = msg;
  el.style.display = "block";
}

function hide_init_error() {
  const el = document.getElementById("init_error");
  el.style.display = "none";
}

// ========== Chat ==========
async function send_message() {
  const text = input_el.value.trim();
  // フリーモード自動進行中に送信 → 停止して待つ
  if (is_sending && _free_continue_running) {
    _free_mode_stop();
    return;
  }
  if ((!text && !pending_image_base64) || is_sending) return;

  // 編集モード中はUI+DB削除してから再送（後続メッセージがある場合のみ確認）
  if (edit_mode_msg_el) {
    if (has_messages_after(edit_mode_msg_el, false)) {
      const confirmed = await show_confirm(t("confirm_delete_after"));
      if (!confirmed) return;
    }
    const msg_el = edit_mode_msg_el;
    const msg_id = edit_mode_msg_id;
    cancel_edit_mode();
    remove_messages_after(msg_el, true);
    await trim_db_from(msg_id);
    // 通常の送信フローへ続く
  }

  // 新規チャット画面からの送信: actor切替 + 画面クリア
  const ncs = document.querySelector(".new_chat_screen");
  if (ncs && selected_actor_id) {
    const switch_res = await fetch(`/api/actor/switch/${selected_actor_id}`, { method: "POST" });
    const switch_data = await switch_res.json();
    if (switch_res.ok) {
      chat_thread_id = switch_data.chat_thread_id;
      _set_title_pill(switch_data.actor_info);
      update_memory_layer_panel();
    }
    ncs.remove();
    _dismiss_mascot();
    _set_topbar_mode("chat");
    // 新規チャット画面が消えたのでエンジンバッジ＆テーマを更新
    await update_engine_badge();
  }

  is_sending = true;
  btn_send.disabled = true;
  input_el.value = "";
  input_el.style.height = "auto";

  // 画像プレビューをユーザーメッセージに含めてから送信用にキャプチャ
  const send_image_base64 = pending_image_base64;
  const send_image_media_type = pending_image_media_type;
  const send_image_data_url = pending_image_data_url;
  // プレビューをクリア
  if (pending_image_base64) {
    pending_image_base64 = "";
    pending_image_data_url = "";
    const preview_div = document.getElementById("image_preview_bar");
    if (preview_div) preview_div.style.display = "none";
    const btn_image = document.getElementById("btn_image");
    if (btn_image) { btn_image.style.borderColor = "#555"; btn_image.style.color = "#aaa"; }
  }

  // ユーザーメッセージ表示（msg_idはサーバーレスポンス後にセット）
  const user_msg_el = add_message("user", text, null, send_image_data_url);

  // Thinking表示
  const thinking = add_thinking();
  const status_timer = start_status_polling(chat_thread_id, thinking);

  try {
    // ========== 会議モード分岐 ==========
    if (is_multi_mode) {
      const multi_body = { message: text || t("msg_speech"), chat_thread_id: chat_thread_id, lang: get_lang() };
      if (send_image_base64) {
        multi_body.image_base64 = send_image_base64;
        multi_body.image_media_type = send_image_media_type;
      }
      const multi_res = await fetch("/api/multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(multi_body),
      });
      const multi_data = await multi_res.json();

      stop_status_polling(status_timer);
      remove_thinking(thinking);

      if (multi_res.ok) {
        chat_thread_id = multi_data.chat_thread_id || chat_thread_id;
        update_url(chat_thread_id);
        if (multi_data.user_msg_id) user_msg_el.dataset.msg_id = multi_data.user_msg_id;

        // 途中参加・退出メッセージ
        if (multi_data.participant_changes) {
          for (const ch of multi_data.participant_changes) {
            add_cerebellum_message(ch.message);
          }
          try {
            const mp_res = await fetch(`/api/multi/participants?chat_thread_id=${chat_thread_id}`);
            const mp_data = await mp_res.json();
            if (mp_data.participants) {
              multi_participants = mp_data.participants;
              title_pill.textContent = _multi_title(multi_participants);
              _show_multi_participants_bar(multi_participants, multi_conv_mode);
              _apply_multi_mode_ui(multi_participants);
            }
          } catch (e) {}
        }

        // 応答描画（共通ヘルパー）
        _render_multi_responses(multi_data);

        // UMAバッジ更新（会議の平均温度）
        if (multi_data.uma_temperature != null) update_uma_badge(multi_data.uma_temperature);

        // フリーモード自動継続ループ
        if (multi_data.free_continue) {
          await _free_mode_continue_loop(chat_thread_id);
        }

        // 指名モード: 発言保存後、指名待ちヒントを表示
        if (multi_conv_mode === "nomination" && (!multi_data.responses || multi_data.responses.length === 0)) {
          document.querySelectorAll(".nomination_hint").forEach(el => el.remove());
          const hint = document.createElement("div");
          hint.className = "system_event nomination_hint";
          hint.textContent = t("nomination_waiting_hint") || "↓ 次の発言者を指名してください";
          document.getElementById("chat")?.appendChild(hint);
          scroll_to_bottom();
        }

        update_memory_layer_panel();
      } else {
        add_system_message(`${t("meeting_error")}: ${multi_data.error || t("meeting_unknown_error")}`);
      }

      is_sending = false;
      btn_send.disabled = false;
      input_el.focus();
      return;
    }

    // ========== 通常モード（single） ==========
    const body_obj = { message: text || t("msg_image"), chat_thread_id: chat_thread_id, lang: get_lang() };
    if (send_image_base64) {
      body_obj.image_base64 = send_image_base64;
      body_obj.image_media_type = send_image_media_type;
      console.log(`[IMAGE] 送信: base64 length=${send_image_base64.length}, media_type=${send_image_media_type}`);
    } else {
      console.log("[IMAGE] 画像なし送信");
    }
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body_obj),
    });
    const data = await res.json();
    console.log("[DEBUG] server response _debug:", JSON.stringify(data.side_effect?._debug));

    // Thinking削除
    stop_status_polling(status_timer);
    remove_thinking(thinking);

    if (res.ok) {
      chat_thread_id = data.chat_thread_id || chat_thread_id;
      update_url(chat_thread_id);
      // ユーザーメッセージのDBのIDをDOMにセット（リトライトリム用）
      if (data.user_msg_id) user_msg_el.dataset.msg_id = data.user_msg_id;

      // サイドエフェクト（発言前に表示すべきもの）
      if (data.side_effect) {
        // LUGJ切替（発言前に表示）
        if (data.side_effect.lugj_toggled) {
          const l = data.side_effect.lugj_toggled;
          add_system_message(l.enabled ? t("lugj_on") : t("lugj_off"));
        }
        // オーバーレイ変更（発言前に表示）
        if (data.side_effect.overlay_changed) {
          const ov = data.side_effect.overlay_changed;
          if (ov.action === "clear") {
            update_ov_badge(null);
            add_system_message(t("cs_ov_cleared"));
          } else if (ov.action === "set") {
            update_ov_badge({ name: ov.ov_name });
            add_system_message(t("ov_applied").replace("{name}", ov.ov_name));
          }
        }
      }

      // 開発者モード: system_promptをコンソール出力
      if (data._debug_system_prompt) {
        console.groupCollapsed("%c[EPL DEBUG] system_prompt", "color:#f0a500;font-weight:bold");
        console.log(data._debug_system_prompt);
        console.groupEnd();
      }

      const ai_msg_el = add_message("ai", data.response);
      // モデル名を薄く表示 + セレベトースト
      const _active_model = data.side_effect?._debug?.active_model || "";
      if (_active_model) {
        const _model_short = _shorten_model(_active_model);
        const _model_label = document.createElement("div");
        _model_label.className = "msg_model_label";
        _model_label.textContent = _model_short;
        ai_msg_el.appendChild(_model_label);
        // ② セレベトースト表示
        const _cb_ms = data.side_effect?._debug?.cerebellum_ms || 0;
        show_cerebellum_toast(_active_model, _cb_ms);
      }
      // 記憶パネル更新（会話のたびに）
      update_memory_layer_panel();
      // UMAバッジを毎回更新
      if (data.uma_temperature != null) update_uma_badge(data.uma_temperature);
      if (data.uma_distance != null) update_distance_badge(data.uma_distance);

      // サイドエフェクト（発言後に表示するもの）
      if (data.side_effect) {
        if (data.side_effect.immersion_changed) {
          const c = data.side_effect.immersion_changed;
          update_immersion_badge(data.actor_info);
          add_system_message(t("immersion_changed").replace("{old}", c.old_immersion).replace("{new}", c.new_immersion));
        }
        if (data.side_effect.chat_thread_immersion_changed) {
          const c = data.side_effect.chat_thread_immersion_changed;
          update_immersion_badge(data.actor_info, data.chat_thread_immersion);
          add_system_message(t("immersion_chat_set").replace("{val}", c.new_chat_thread_immersion));
        }
        // 個性の更新
        if (data.side_effect.trait_updated) {
          const tu = data.side_effect.trait_updated;
          if (tu.auto_approved) {
            add_system_message(t("trait_auto_updated").replace("{name}", tu.label || tu.trait).replace("{reason}", tu.auto_approved_reason || t("trait_auto_default_reason")));
          } else {
            add_system_message(t("trait_manual_updated").replace("{name}", tu.label || tu.trait));
          }
        }
        if (data.side_effect.trait_pending_approval) {
          show_trait_approval(data.side_effect.trait_pending_approval);
        }
        if (data.side_effect.trait_rejected) {
          const tr = data.side_effect.trait_rejected;
          add_system_message(t("trait_change_rejected").replace("{reason}", tr.reason));
        }
        // 経験の記録 → system_eventsに統一（サーバー側で glow 判定込みで送信）
        // 会話の重さ
        if (data.side_effect.chat_thread_heavy_changed) {
          // 静かに記録（通知は出さない）
        }
        // UMA温度変化
        if (data.side_effect.uma_temperature_changed) {
          const u = data.side_effect.uma_temperature_changed;
          update_uma_badge(u.actual_temperature);
          if (u.inertia_message) {
            add_system_message(u.inertia_message);
          } else {
            add_system_message(t("temp_changed").replace("{old}", u.old_temperature).replace("{new}", u.actual_temperature).replace("{label}", u.label));
          }
        }
        // UMA距離感変化
        if (data.side_effect.uma_distance_changed) {
          const d = data.side_effect.uma_distance_changed;
          update_distance_badge(d.new_distance);
          add_system_message(t("dist_changed").replace("{old}", d.old_distance).replace("{new}", d.new_distance).replace("{label}", d.label));
        }
        // 関係性UMA変更
        if (data.side_effect.relationship_uma_changed) {
          const r = data.side_effect.relationship_uma_changed;
          add_system_message(t("rel_uma_changed").replace("{temp}", r.base_temperature).replace("{dist}", r.base_distance));
        }
        // Actor交代
        if (data.side_effect.actor_switched) {
          const s = data.side_effect.actor_switched;
          // ヘッダーのActor名を更新（show_role_label対応）
          _set_title_pill(data.actor_info || s.new_actor);
          // 没入度バッジを更新
          update_immersion_badge(data.actor_info);
          // 温度・距離バッジも更新
          update_uma_badge(data.uma_temperature);
          update_distance_badge(data.uma_distance);
          add_system_message(t("actor_switched").replace("{old}", s.old_actor.name).replace("{new}", s.new_actor.name));
        }
        // 名前設定（set_my_name）
        if (data.side_effect.name_set) {
          const ns = data.side_effect.name_set;
          _set_title_pill(data.actor_info || { name: ns.name });
          add_system_message(
            `${t("name_set").replace("{name}", ns.name)} <a href="javascript:location.reload()" style="color:#f0a500;text-decoration:underline;">${t("name_reload")}</a>`,
            {raw_html: true}
          );
        }
        // 役割名変更（update_role_name）
        if (data.side_effect.role_name_changed) {
          _set_title_pill(data.actor_info);
        }
        // Personal持ち帰り提案（pending状態で保存された）
        if (data.side_effect.trait_pending_carry_back) {
          const t = data.side_effect.trait_pending_carry_back;
          add_system_message(window.t("trait_carry_back").replace("{label}", t.label));
        }
        // 本体呼び出し時の pending trait 通知
        if (data.side_effect.pending_traits && data.side_effect.pending_traits.length > 0) {
          show_pending_traits(data.side_effect.pending_traits);
        }
      }
      // システムイベント（リアルタイム表示）
      if (data.system_events && data.system_events.length > 0) {
        for (const evt of data.system_events) {
          if (typeof evt === "object" && evt.text) {
            add_system_message(evt.text, {glow: !!evt.glow});
          } else {
            add_system_message(evt);
          }
        }
      }
      // コーヒーブレイク（セレベ経由）
      if (data.nudge) {
        _show_nudge(data.nudge);
      }
    } else {
      // エラー時もmsg_idをセット（リトライ時のtrimに使う）
      if (data.user_msg_id) user_msg_el.dataset.msg_id = data.user_msg_id;
      add_system_message(translate_error(data.error, res.status));
    }
  } catch (e) {
    stop_status_polling(status_timer);
    remove_thinking(thinking);
    add_system_message(t("server_error_network"));
    console.error("Chat error:", e);
  }

  is_sending = false;
  btn_send.disabled = false;
  input_el.focus();
  update_engine_badge();
}

// ========== Error Translation ==========
function translate_error(raw_msg, status_code) {
  const msg = (raw_msg || "").toLowerCase();
  if (status_code === 529 || msg.includes("overloaded")) return t("err_overloaded");
  if (status_code === 529 || msg.includes("529")) return t("err_overloaded");
  if (msg.includes("rate") && msg.includes("limit")) return t("err_rate_limit");
  if (msg.includes("timeout") || msg.includes("timed out")) return t("err_timeout");
  if (msg.includes("authentication") || msg.includes("unauthorized") || msg.includes("401")) return t("err_auth");
  if (msg.includes("insufficient") || msg.includes("credit") || msg.includes("402")) return t("err_credit");
  if (msg.includes("context") && msg.includes("length")) return t("err_too_long");
  if (msg.includes("server") || msg.includes("500") || msg.includes("502") || msg.includes("503")) return t("err_server");
  return raw_msg || t("err_generic");
}

// ========== Markdown / Text Rendering ==========

function render_text(text) {
  // XSS対策: まずHTMLエスケープ
  let safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // コードブロック ```...```
  safe = safe.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // インラインコード `...`
  safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 太字 **...**
  safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // 斜体 *...*
  safe = safe.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // 改行
  safe = safe.replace(/\n/g, "<br>");

  return safe;
}

// ========== Image Popup ==========
function show_image_popup(src) {
  // 既存ポップアップがあれば削除
  const existing = document.getElementById("img_popup_overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "img_popup_overlay";
  overlay.style.cssText = [
    "position:fixed", "inset:0", "background:rgba(0,0,0,0.85)",
    "display:flex", "align-items:center", "justify-content:center",
    "z-index:9999", "cursor:zoom-out", "padding:20px", "box-sizing:border-box"
  ].join(";");

  const img = document.createElement("img");
  img.src = src;
  img.style.cssText = "max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 4px 40px rgba(0,0,0,0.6);object-fit:contain;";

  // ×ボタン
  const btn_close = document.createElement("button");
  btn_close.textContent = "✕";
  btn_close.style.cssText = "position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:24px;cursor:pointer;opacity:0.8;";
  btn_close.addEventListener("click", (e) => { e.stopPropagation(); overlay.remove(); });

  overlay.appendChild(img);
  overlay.appendChild(btn_close);
  overlay.addEventListener("click", () => overlay.remove());
  img.addEventListener("click", (e) => e.stopPropagation()); // 画像クリックでは閉じない
  document.body.appendChild(overlay);

  // ESCキーで閉じる
  const on_esc = (e) => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", on_esc); } };
  document.addEventListener("keydown", on_esc);
}

// ========== Message DOM ==========
function add_message(role, text, msg_id = null, image_data_url = "") {
  const div = document.createElement("div");
  div.classList.add("msg");
  div.classList.add(role === "user" ? "msg_user" : "msg_ai");

  // 生テキストを保持（再送用）
  div.dataset.raw_text = text;
  // DBのmsg_idを保持（リトライトリム用）
  if (msg_id) div.dataset.msg_id = msg_id;
  if (msg_id && (current_dev_flag >= 1 || imitation_dev_mode)) div.title = `#${msg_id}`;

  // 画像プレビュー（ユーザーメッセージに添付画像がある場合）
  // image_data_url: 送信直後のbase64 data URL、またはDBから読んだ /static/uploads/... パス
  const img_src = image_data_url || "";
  if (img_src) {
    const img = document.createElement("img");
    img.src = img_src;
    img.style.cssText = "max-width:240px;max-height:180px;border-radius:8px;margin-bottom:6px;display:block;cursor:zoom-in;";
    img.title = t("click_enlarge");
    img.addEventListener("click", () => show_image_popup(img_src));
    img.addEventListener("error", () => {
      img.replaceWith((() => {
        const expired = document.createElement("div");
        expired.textContent = t("image_expired");
        expired.style.cssText = "font-size:12px;color:#888;padding:6px 10px;border:1px solid #444;border-radius:6px;margin-bottom:6px;display:inline-block;";
        return expired;
      })());
    });
    div.appendChild(img);
  }

  // メッセージ本文
  const body = document.createElement("div");
  body.classList.add("msg_body");
  body.innerHTML = render_text(text);
  div.appendChild(body);

  // アクションバー（ホバーで表示）
  const bar = document.createElement("div");
  bar.classList.add("msg_action_bar");

  // コピーボタン（user / ai 両方）
  const copy_icon_svg = `<svg viewBox="0 0 24 24" class="msg_action_icon"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const btn_copy = document.createElement("button");
  btn_copy.className = "msg_action_btn";
  btn_copy.title = t("copy");
  btn_copy.innerHTML = copy_icon_svg;
  btn_copy.addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(() => {
      btn_copy.innerHTML = `<svg viewBox="0 0 24 24" class="msg_action_icon"><polyline points="20 6 9 17 4 12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      setTimeout(() => { btn_copy.innerHTML = copy_icon_svg; }, 1500);
    });
  });
  bar.appendChild(btn_copy);

  if (role === "user") {
    // 編集ボタン（ユーザー発言を編集して再送）
    const btn_edit = document.createElement("button");
    btn_edit.className = "msg_action_btn";
    btn_edit.title = t("edit_resend");
    btn_edit.innerHTML = `<svg viewBox="0 0 24 24" class="msg_action_icon"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn_edit.addEventListener("click", () => start_edit_message(div, text));
    bar.appendChild(btn_edit);
    // 再送ボタン（ユーザー発言を送り直す）
    const btn_retry = document.createElement("button");
    btn_retry.className = "msg_action_btn";
    btn_retry.title = t("resend");
    btn_retry.innerHTML = `<svg viewBox="0 0 24 24" class="msg_action_icon"><polyline points="23 4 23 10 17 10" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn_retry.addEventListener("click", () => retry_message(div, text));
    bar.appendChild(btn_retry);
  } else {
    // 再生成ボタン（AI応答を取り直す）
    const btn_regen = document.createElement("button");
    btn_regen.className = "msg_action_btn";
    btn_regen.title = t("regenerate");
    btn_regen.innerHTML = `<svg viewBox="0 0 24 24" class="msg_action_icon"><polyline points="1 4 1 10 7 10" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="23 20 23 14 17 14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btn_regen.addEventListener("click", () => retry_message(div, null));
    bar.appendChild(btn_regen);
  }

  div.appendChild(bar);
  chat_el.appendChild(div);

  // ユーザー: 一番下までスクロール / AI: 応答の先頭が見える位置
  if (role === "user") {
    scroll_to_bottom();
  } else {
    scroll_to_element(div);
  }
  return div;
}

// 編集モード開始: メッセージの場所で直接インライン編集
function start_edit_message(msg_el, text) {
  if (is_sending) return;
  // 既に別のメッセージを編集中なら先にキャンセル
  if (edit_mode_msg_el && edit_mode_msg_el !== msg_el) cancel_edit_mode();

  edit_mode_msg_el = msg_el;
  edit_mode_msg_id = msg_el.dataset.msg_id || null;

  const body = msg_el.querySelector(".msg_body");
  if (!body) return;

  // msg_bodyの内容をtextareaに置き換え
  body._original_html = body.innerHTML;
  body._original_text = text;

  // 元のサイズを記録してからtextareaに変換
  const orig_height = body.offsetHeight;
  const orig_width = body.offsetWidth;

  const ta = document.createElement("textarea");
  ta.className = "inline_edit_textarea";
  ta.value = text;
  ta.style.cssText = `width:${orig_width}px;min-height:${Math.max(orig_height, 60)}px;max-height:500px;padding:8px 10px;border:1px solid var(--accent);border-radius:8px;background:var(--bg-secondary,#1a1a2e);color:var(--text);font-size:14px;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.6;`;

  // ボタン行
  const btn_row = document.createElement("div");
  btn_row.className = "inline_edit_btns";
  btn_row.style.cssText = "display:flex;gap:8px;margin-top:6px;justify-content:flex-end;";

  const btn_cancel = document.createElement("button");
  btn_cancel.textContent = "✕";
  btn_cancel.title = t("cancel") || "Cancel";
  btn_cancel.style.cssText = "padding:4px 12px;border:1px solid #555;border-radius:6px;background:transparent;color:var(--text);cursor:pointer;font-size:13px;";
  btn_cancel.addEventListener("click", () => cancel_edit_mode());

  const btn_send = document.createElement("button");
  btn_send.textContent = "✏️ " + (t("edit_resend") || "Send");
  btn_send.style.cssText = "padding:4px 14px;border:none;border-radius:6px;background:var(--accent);color:#000;cursor:pointer;font-size:13px;font-weight:600;";
  btn_send.addEventListener("click", () => {
    const new_text = ta.value.trim();
    if (!new_text) return;
    _submit_inline_edit(msg_el, new_text);
  });

  btn_row.appendChild(btn_cancel);
  btn_row.appendChild(btn_send);

  body.innerHTML = "";
  body.appendChild(ta);
  body.appendChild(btn_row);

  // テキストエリアの高さを自動調整（元のメッセージ以上のサイズを確保）
  ta.style.height = "auto";
  ta.style.height = Math.max(ta.scrollHeight, orig_height) + "px";
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  // Ctrl+Enter で送信
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      btn_send.click();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel_edit_mode();
    }
  });

  // アクションバーを非表示
  const bar = msg_el.querySelector(".msg_action_bar");
  if (bar) bar.style.display = "none";
}

// インライン編集の送信処理
async function _submit_inline_edit(msg_el, new_text) {
  if (is_sending) return;
  const msg_id = msg_el.dataset.msg_id || null;

  if (has_messages_after(msg_el, false)) {
    const confirmed = await show_confirm(t("confirm_delete_after"));
    if (!confirmed) return;
  }

  cancel_edit_mode();
  remove_messages_after(msg_el, true);
  await trim_db_from(msg_id);

  // 下部入力欄経由で送信
  input_el.value = new_text;
  send_message();
}

// 編集モードキャンセル
function cancel_edit_mode() {
  if (edit_mode_msg_el) {
    const body = edit_mode_msg_el.querySelector(".msg_body");
    if (body && body._original_html) {
      body.innerHTML = body._original_html;
      delete body._original_html;
      delete body._original_text;
    }
    // アクションバーを復元
    const bar = edit_mode_msg_el.querySelector(".msg_action_bar");
    if (bar) bar.style.display = "";
  }
  edit_mode_msg_el = null;
  edit_mode_msg_id = null;
  document.getElementById("edit_mode_badge")?.remove();
}

// DBトリム: msg_id以降を物理削除
async function trim_db_from(msg_id) {
  if (!msg_id || !chat_thread_id) return;
  try {
    await fetch(`/api/chat_thread/${chat_thread_id}/messages/from/${msg_id}`, { method: "DELETE" });
  } catch (e) {
    console.error("trim_db_from error:", e);
  }
}

// 再送処理
async function retry_message(msg_el, user_text) {
  if (is_sending) return;

  if (user_text) {
    // ユーザー発言の再送: そのメッセージ以降をUI＋DB両方から削除して再送
    const msg_id = msg_el.dataset.msg_id;
    if (has_messages_after(msg_el, false)) {
      const confirmed = await show_confirm(t("confirm_delete_after"));
      if (!confirmed) return;
    }
    remove_messages_after(msg_el, true);
    await trim_db_from(msg_id);
    input_el.value = user_text;
    send_message();
  } else {
    // AI発言の再送: 直前のユーザー発言から以降をUI＋DB両方から削除して再送
    const prev_user = find_prev_user_message(msg_el);
    if (prev_user) {
      const user_text_raw = prev_user.dataset.raw_text;
      const msg_id = prev_user.dataset.msg_id;
      if (has_messages_after(prev_user, false)) {
        const confirmed = await show_confirm(t("confirm_delete_after"));
        if (!confirmed) return;
      }
      remove_messages_after(prev_user, false);
      await trim_db_from(msg_id);
      input_el.value = user_text_raw;
      send_message();
    }
  }
}

function remove_messages_after(msg_el, include_self) {
  const messages = Array.from(chat_el.children);
  const idx = messages.indexOf(msg_el);
  if (idx < 0) return;
  const start = include_self ? idx : idx + 1;
  for (let i = messages.length - 1; i >= start; i--) {
    messages[i].remove();
  }
}

// 後続メッセージが存在するか確認
function has_messages_after(msg_el, include_self) {
  const messages = Array.from(chat_el.children);
  const idx = messages.indexOf(msg_el);
  if (idx < 0) return false;
  const start = include_self ? idx : idx + 1;
  return messages.length > start;
}

function find_prev_user_message(msg_el) {
  let el = msg_el.previousElementSibling;
  while (el) {
    if (el.classList.contains("msg_user")) return el;
    el = el.previousElementSibling;
  }
  return null;
}

function add_system_message(text, {raw_html = false, glow = false} = {}) {
  // DB保存形式 {"t":"テキスト","g":"gold"} を解析
  let _text = text, _g = glow;
  if (!_g && typeof text === "string" && text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.t) { _text = parsed.t; _g = parsed.g || false; }
    } catch (e) { /* not JSON, use as-is */ }
  }
  const div = document.createElement("div");
  div.classList.add("msg", "msg_system");
  if (_g === "gold" || _g === true) div.classList.add("sys_glow_gold");
  else if (_g === "cyan") div.classList.add("sys_glow_cyan");
  div.innerHTML = raw_html ? _text : render_text(_text);
  chat_el.appendChild(div);
  scroll_to_bottom();
}

// ========== Trait Approval Card ==========

function escape_html(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}

// trait label 翻訳マッピング (JA→EN)
const _TRAIT_LABEL_EN = {
  "性格": "Personality", "口調": "Speech style", "一人称": "Pronoun",
  "オーナーの呼び方": "How to address owner", "性別・性自認": "Gender identity",
  "自己イメージ": "Self-image", "種族": "Species", "特技・スキル": "Skills",
  "オーナーが託した言葉": "Owner's message",
};
function _trait_label(raw) {
  if (get_lang() === "en" && _TRAIT_LABEL_EN[raw]) return _TRAIT_LABEL_EN[raw];
  return raw;
}

function show_trait_approval(pending) {
  const card = document.createElement("div");
  card.classList.add("msg", "msg_approval");
  const title = pending.is_first_install
    ? t("trait_install_confirm")
    : t("trait_update_title");
  card.innerHTML = `
    <div class="approval_title">${title}</div>
    <div class="approval_detail">
      <div class="approval_label">${escape_html(_trait_label(pending.label || pending.trait))}</div>
      <div class="approval_desc">${escape_html(pending.new_description)}</div>
      <div class="approval_reason">${t("approval_reason")}: ${escape_html(pending.reason)}</div>
      <div class="approval_meta">${t("approval_mix")}: ${pending.mix_ratio}</div>
      <div class="approval_gates">
        <span class="gate_badge">${t("approval_impact")}:${pending.four_gate.impact_weight}</span>
        <span class="gate_badge">${t("approval_benefit")}:${pending.four_gate.owner_benefit}</span>
        <span class="gate_badge">${t("approval_integrity")}:${pending.four_gate.self_integrity}</span>
        <span class="gate_badge">${t("approval_safety")}:${pending.four_gate.identity_safety}</span>
      </div>
    </div>
    <div class="approval_action">
      <button class="btn_approve" data-id="${pending.approval_id}">${t("approval_approve")}</button>
      <button class="btn_reject" data-id="${pending.approval_id}">${t("approval_reject")}</button>
    </div>
  `;
  chat_el.appendChild(card);
  scroll_to_bottom();

  card.querySelector(".btn_approve").addEventListener("click", () => resolve_approval(pending.approval_id, true, card));
  card.querySelector(".btn_reject").addEventListener("click", () => resolve_approval(pending.approval_id, false, card));
}

async function resolve_approval(approval_id, approved, card_el) {
  try {
    const res = await fetch(`/api/approval/${approval_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    const data = await res.json();
    const action_el = card_el.querySelector(".approval_action");
    if (approved) {
      action_el.innerHTML = `<span class="approval_result approved">${t("approval_approved")}</span>`;
      add_system_message(t("trait_updated").replace("{name}", data.label || data.trait));
    } else {
      action_el.innerHTML = `<span class="approval_result rejected">${t("approval_rejected")}</span>`;
      add_system_message(t("trait_rejected_msg"));
    }
    // 同じtraitの他の承認モーダルをUIから除去（サーバー側で一括削除済み）
    document.querySelectorAll(".msg_approval").forEach(el => {
      if (el !== card_el) el.remove();
    });
  } catch (e) {
    console.error("Approval error:", e);
    add_system_message(t("trait_approve_error"));
  }
}

// ========== Pending Trait Approval (本体確認用) ==========

function show_pending_traits(traits) {
  for (const t of traits) {
    const card = document.createElement("div");
    card.classList.add("msg", "msg_approval", "msg_pending_carry_back");
    card.innerHTML = `
      <div class="approval_title">${window.t("approval_carry_back")}</div>
      <div class="approval_detail">
        <div class="approval_label">${escape_html(t.label)}</div>
        <div class="approval_desc">${escape_html(t.description)}</div>
        <div class="approval_meta">${window.t("approval_strength")}: ${t.intensity} / ${window.t("approval_source")}: ${t.source}</div>
      </div>
      <div class="approval_action">
        <button class="btn_approve" data-id="${t.id}">${window.t("approval_accept")}</button>
        <button class="btn_reject" data-id="${t.id}">${window.t("approval_decline")}</button>
      </div>
    `;
    chat_el.appendChild(card);
    scroll_to_bottom();

    card.querySelector(".btn_approve").addEventListener("click", () => resolve_pending_trait(t.id, true, card));
    card.querySelector(".btn_reject").addEventListener("click", () => resolve_pending_trait(t.id, false, card));
  }
}

async function resolve_pending_trait(trait_id, approved, card_el) {
  try {
    const res = await fetch(`/api/pending_trait/${trait_id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    const data = await res.json();
    const action_el = card_el.querySelector(".approval_action");
    if (approved) {
      action_el.innerHTML = `<span class="approval_result approved">${t("approval_accepted")}</span>`;
      add_system_message(t("trait_accepted"));
    } else {
      action_el.innerHTML = `<span class="approval_result rejected">${t("approval_declined")}</span>`;
      add_system_message(t("trait_declined"));
    }
  } catch (e) {
    console.error("Pending trait resolve error:", e);
    add_system_message(t("trait_approve_error"));
  }
}

function add_thinking() {
  const div = document.createElement("div");
  div.classList.add("thinking");
  div.innerHTML = '<div class="thinking_dot"></div><div class="thinking_dot"></div><div class="thinking_dot"></div><span class="thinking_hint"></span>';
  chat_el.appendChild(div);
  scroll_to_bottom();
  return div;
}

function remove_thinking(el) {
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

function start_status_polling(thread_id, thinking_el) {
  let last_hint = "";
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${thread_id}`);
      const data = await res.json();
      const hint = data.hint || "";
      if (hint !== last_hint) {
        last_hint = hint;
        const span = thinking_el.querySelector(".thinking_hint");
        if (span) {
          if (hint) {
            span.textContent = " " + hint;
            span.style.opacity = "0";
            requestAnimationFrame(() => { span.style.transition = "opacity 0.3s"; span.style.opacity = "1"; });
          } else {
            span.textContent = "";
          }
        }
      }
    } catch (_) {}
  }, 600);
  return timer;
}

function stop_status_polling(timer) {
  if (timer) clearInterval(timer);
}

// --- 自動スクロール制御 ---
let _auto_scroll_enabled = true;

function scroll_to_bottom(force) {
  if (!force && !_auto_scroll_enabled) return;
  const wrap = document.querySelector(".chat_wrap");
  if (!wrap) return;
  if (force) {
    // ビュオーん（ボタン押下時: スムーズスクロール）
    wrap.scrollTo({ top: wrap.scrollHeight, behavior: "smooth" });
  } else {
    // 通常の自動スクロール（新メッセージ到着時: 即座に）
    requestAnimationFrame(() => {
      wrap.scrollTop = wrap.scrollHeight;
      setTimeout(() => { wrap.scrollTop = wrap.scrollHeight; }, 150);
    });
  }
  _auto_scroll_enabled = true;
  _update_scroll_btn();
}

function _update_scroll_btn() {
  const btn = document.getElementById("btn_scroll_bottom");
  if (!btn) return;
  btn.style.display = _auto_scroll_enabled ? "none" : "flex";
}

// スクロール監視 + 「↓」ボタン生成
(function _init_scroll_watcher() {
  const wrap = document.querySelector(".chat_wrap");
  if (!wrap) return;

  // ボタン生成
  const btn = document.createElement("button");
  btn.id = "btn_scroll_bottom";
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`;
  btn.style.cssText = `
    display:none; position:fixed; bottom:120px; left:50%; transform:translateX(-50%);
    width:40px; height:40px; border-radius:50%; border:1px solid #555;
    background:rgba(30,30,30,0.9); color:#ccc; cursor:pointer;
    align-items:center; justify-content:center; z-index:150;
    box-shadow:0 2px 8px rgba(0,0,0,0.5); transition:opacity 0.2s;
  `;
  btn.addEventListener("click", () => scroll_to_bottom(true));
  document.body.appendChild(btn);

  // スクロールイベント: 半画面以上上にいたら自動スクロール停止
  let _scroll_timer = null;
  wrap.addEventListener("scroll", () => {
    if (_scroll_timer) return;
    _scroll_timer = setTimeout(() => {
      _scroll_timer = null;
      const distFromBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
      if (distFromBottom > wrap.clientHeight * 0.5) {
        // 半画面以上スクロールアップ → 自動スクロール停止
        if (_auto_scroll_enabled) {
          _auto_scroll_enabled = false;
          _update_scroll_btn();
        }
      } else if (distFromBottom < 30) {
        // ほぼ最下部 → 自動スクロール再開
        if (!_auto_scroll_enabled) {
          _auto_scroll_enabled = true;
          _update_scroll_btn();
        }
      }
    }, 100);
  });
})();

// composer_dock の高さ変動に追従して chat_wrap の padding-bottom を動的調整
(function _init_composer_resize_observer() {
  const dock = document.getElementById("composer_dock");
  const wrap = document.querySelector(".chat_wrap");
  if (!dock || !wrap) return;
  let _prev_h = 0;
  const _update = () => {
    const h = dock.offsetHeight;
    if (h !== _prev_h) {
      _prev_h = h;
      wrap.style.paddingBottom = (h + 16) + "px";
    }
  };
  new ResizeObserver(_update).observe(dock);
  _update();
})();

function scroll_to_element(el) {
  setTimeout(() => {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 150);
}

// ========== Chat Thread End ==========
btn_end_chat_thread.addEventListener("click", async (e) => {
  // アーカイブ済みスレッドの場合はreopen onclickに任せる
  if (btn_end_chat_thread.dataset.closed === "true") return;
  const action = await show_end_confirm();
  if (!action) return;
  if (action === "delete") {
    confirm_delete_chat(chat_thread_id, t("cs_delete_chat"));
  } else {
    await close_chat_thread(chat_thread_id);
  }
});

// ========== スレッド固定化・再開・引き継ぎ ==========

async function close_chat_thread(thread_id) {
  btn_end_chat_thread.disabled = true;
  btn_end_chat_thread.textContent = t("summarizing");
  try {
    const res = await fetch(`/api/chat_thread/${thread_id}/close`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      set_thread_closed_ui(data.summary_500);
      const learn_msg = data.knowledge_learning ? t("archive_learn") : t("archive_done");
      add_system_message(learn_msg);
      localStorage.setItem("ob_archive_done", "1");
      // 吹き出しがあれば消す
      document.querySelector(".ob_archive_bubble")?.remove();
    } else {
      // 失敗時もボタンを元に戻す
      btn_end_chat_thread.disabled = false;
      btn_end_chat_thread.innerHTML = `<svg viewBox="0 0 24 24" class="svg_icon" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" stroke-width="1.8" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke-width="1.8" stroke-linecap="round"/></svg>`;
      console.error("close failed:", data);
    }
  } catch (e) {
    console.error("close error:", e);
    btn_end_chat_thread.disabled = false;
    btn_end_chat_thread.innerHTML = `<svg viewBox="0 0 24 24" class="svg_icon" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" stroke-width="1.8" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
}

function set_thread_closed_ui(summary_500 = "") {
  // 入力を無効化
  const composer = document.getElementById("composer_dock");
  if (composer) {
    composer.style.display = "none";
  }
  // 終了ボタンをアーカイブアイコンに変更（ヘッダー内）
  const btn = btn_end_chat_thread;
  btn.dataset.closed = "true";
  btn.disabled = false;
  btn.style.position = "relative";
  btn.innerHTML = `<svg viewBox="0 0 24 24" class="svg_icon" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:#b8962e;stroke:#b8962e;"><path d="M21 8H3l1 13h16L21 8z"/><path d="M1 8h22"/><path d="M10 8V5a2 2 0 0 1 4 0v3"/></svg>`;
  btn.title = t("tip_resume");
  btn.onclick = (e) => {
    e.stopPropagation();
    toggle_reopen_menu(btn);
  };

  // 入力エリア上部に目立つバナーを表示
  if (!document.getElementById("closed_banner")) {
    const banner = document.createElement("div");
    banner.id = "closed_banner";
    banner.className = "closed_banner";
    banner.innerHTML = `
      <span class="closed_banner_label">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" style="vertical-align:-2px;margin-right:5px;"><path d="M21 8H3l1 13h16L21 8z"/><path d="M1 8h22"/><path d="M10 8V5a2 2 0 0 1 4 0v3"/></svg>${t("archive_banner")}
      </span>
      <div class="closed_banner_btns">
        <button class="closed_banner_btn" onclick="do_reopen()">${t("archive_reopen")}</button>
        <button class="closed_banner_btn" onclick="do_inherit()">${t("archive_inherit")}</button>
      </div>
    `;
    if (composer) {
      composer.parentElement.insertBefore(banner, composer);
    }
  }
}

function toggle_reopen_menu(anchor) {
  let menu = document.getElementById("reopen_menu");
  if (menu) { menu.remove(); return; }
  menu = document.createElement("div");
  menu.id = "reopen_menu";
  menu.className = "reopen_menu";
  menu.innerHTML = `
    <button class="reopen_menu_item" onclick="do_reopen()">📂 ${t("reopen_this")}</button>
    <button class="reopen_menu_item" onclick="do_inherit()">🔗 ${t("reopen_inherit")}</button>
  `;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.top = (rect.bottom + 6) + "px";
  menu.style.left = rect.left + "px";
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

async function do_reopen() {
  document.getElementById("reopen_menu")?.remove();
  document.getElementById("closed_banner")?.remove();
  await fetch(`/api/chat_thread/${chat_thread_id}/reopen`, { method: "POST" });
  // UIを元に戻す
  const composer = document.getElementById("composer_dock");
  if (composer) { composer.style.display = ""; }
  const btn = btn_end_chat_thread;
  btn.dataset.closed = "";
  btn.onclick = null;
  btn.disabled = false;
  btn.innerHTML = `<svg viewBox="0 0 24 24" class="svg_icon" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" stroke-width="1.8" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  btn.title = "End Session";
  add_system_message(t("chat_resumed"));
  // 会議モードならUI復元
  try {
    const mp_res = await fetch(`/api/multi/participants?chat_thread_id=${chat_thread_id}`);
    const mp_data = await mp_res.json();
    if (mp_data.mode === "multi" && mp_data.participants?.length > 0) {
      is_multi_mode = true;
      multi_participants = mp_data.participants;
      multi_conv_mode = mp_data.conversation_mode || "sequential";
      title_pill.textContent = _multi_title(multi_participants);
      _show_multi_participants_bar(multi_participants, multi_conv_mode);
      _apply_multi_mode_ui(multi_participants);
      input_el.placeholder = t("meeting_composer_ph");
    }
  } catch (e) {}
  // サイドバーを更新してアーカイブアイコンを消す
  load_sidebar_chats();
}

async function do_inherit() {
  document.getElementById("reopen_menu")?.remove();

  // 会議モードの場合: 引き継ぎモーダルを表示
  if (is_multi_mode && multi_participants.length > 0) {
    _show_meeting_inherit_modal();
    return;
  }

  // 1対1: 既存動作
  if (!await show_confirm(t("confirm_inherit"))) return;
  document.getElementById("closed_banner")?.remove();
  try {
    const res = await fetch(`/api/chat_thread/${chat_thread_id}/inherit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (res.ok) {
      _apply_inherit_result(data);
    }
  } catch (e) {
    console.error("inherit error:", e);
  }
}

function _apply_inherit_result(data) {
  document.getElementById("closed_banner")?.remove();
  chat_thread_id = data.new_chat_thread_id;
  window.history.replaceState({}, "", `/chat/${chat_thread_id}`);
  const composer = document.getElementById("composer_dock");
  if (composer) { composer.style.display = ""; }
  const btn = btn_end_chat_thread;
  btn.onclick = null;
  btn.dataset.closed = "";
  btn.innerHTML = `<svg viewBox="0 0 24 24" class="svg_icon" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" stroke-width="1.8" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  btn.title = "End Session";
  btn.addEventListener("click", async () => {
    if (!await show_confirm(t("end_confirm"))) return;
    await close_chat_thread(chat_thread_id);
  }, { once: true });

  chat_el.innerHTML = "";

  if (data.mode === "multi" && data.participants?.length > 0) {
    // 会議引き継ぎ → マルチモードUI復元
    is_multi_mode = true;
    multi_participants = data.participants;
    multi_conv_mode = data.conversation_mode || "sequential";
    title_pill.textContent = _multi_title(multi_participants);
    _show_multi_participants_bar(multi_participants, multi_conv_mode);
    _apply_multi_mode_ui(multi_participants);
    input_el.placeholder = t("meeting_composer_ph");
    const names = multi_participants.map(p => p.actor_name).join(", ");
    add_system_message(t("meeting_inherited").replace("{mode}", multi_conv_mode).replace("{names}", names));
    if (data.opening_message) {
      add_system_message("🧠 " + data.opening_message);
    }
  } else {
    const src = data.source_thread_id ? t("resume_src").replace("{id}", data.source_thread_id) : "";
    add_system_message(t("resume_started").replace("{src}", src));
  }
  set_composer_disabled(false);
  load_sidebar_chats();
}

async function _show_meeting_inherit_modal() {
  // 前回の参加者をプリセット、モード変更可能なモーダル
  const _colors = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#16a085"];
  const prev_mode = multi_conv_mode || "sequential";

  const modal = document.createElement("div");
  modal.className = "modal_overlay";
  modal.innerHTML = `
    <div class="modal_box" style="max-width:520px;">
      <div class="modal_header">
        <div class="modal_title">${t("meeting_inherit_title")} <span style="font-size:0.75rem;color:#888;font-weight:normal;">${t("meeting_inherit_sub")}</span></div>
        <button class="modal_close" onclick="this.closest('.modal_overlay').remove()">✕</button>
      </div>
      <div class="modal_body" style="max-height:60vh;overflow-y:auto;">
        <div style="margin-bottom:8px;font-size:0.82rem;color:#aaa;">${t("meeting_inherit_prev")}</div>
        <div id="inherit_actor_list"></div>
        <div style="margin-top:12px;">
          <label style="font-size:0.82rem;color:#aaa;">${t("meeting_conv_mode_label")}</label>
          <select id="inherit_conv_mode" style="background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:0.82rem;margin-left:6px;">
            <option value="sequential" ${prev_mode==="sequential"?"selected":""}>${t("meeting_mode_sequential")}</option>
            <option value="blind" ${prev_mode==="blind"?"selected":""}>${t("meeting_mode_blind")}</option>
            <option value="free" ${prev_mode==="free"?"selected":""}>${t("meeting_mode_free")}</option>
            <option value="nomination" ${prev_mode==="nomination"?"selected":""}>${t("meeting_mode_nomination")}</option>
          </select>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:8px;">
          <label style="font-size:0.82rem;color:#aaa;display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="inherit_opening_msg" checked style="accent-color:var(--accent);">
            ${t("meeting_opening_toggle")}
          </label>
        </div>
        <div style="margin-top:16px;text-align:right;">
          <button id="inherit_create_btn" style="background:var(--accent);color:#000;border:none;border-radius:8px;padding:8px 20px;font-weight:600;cursor:pointer;font-size:0.9rem;">${t("meeting_inherit_start")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // アクター一覧を取得し、前回参加者をチェック済みに
  const res = await fetch("/api/actor");
  const data = await res.json();
  const actor_list = (data.actor || []).filter(a => !a.is_ov);
  const prev_aids = new Set(multi_participants.map(p => p.actor_id));
  const prev_map = {};
  multi_participants.forEach(p => { prev_map[p.actor_id] = p; });

  const list_el = modal.querySelector("#inherit_actor_list");

  // 参加中 / その他 に分離
  const prev_actors = [];
  const other_actors = [];
  actor_list.forEach(a => {
    if (prev_aids.has(a.actor_id)) prev_actors.push(a);
    else other_actors.push(a);
  });

  function _group_by_personal(actors) {
    const grouped = {};
    actors.forEach(a => {
      const pid = a.personal_id || 1;
      if (!grouped[pid]) grouped[pid] = { personal_name: a.personal_name || `Personal ${pid}`, actors: [] };
      grouped[pid].actors.push(a);
    });
    return grouped;
  }

  let color_i = 0;
  function _render_section(actors, container) {
    const grouped = _group_by_personal(actors);
    for (const [pid, g] of Object.entries(grouped)) {
      const sec = document.createElement("div");
      sec.style.cssText = "margin-bottom:8px;";
      sec.innerHTML = `<div style="font-size:0.75rem;color:#666;margin-bottom:4px;">${g.personal_name}</div>`;
      g.actors.forEach(a => {
        const is_prev = prev_aids.has(a.actor_id);
        const color = is_prev ? (prev_map[a.actor_id]?.color || _colors[color_i % _colors.length]) : _colors[color_i % _colors.length];
        const row = document.createElement("label");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:0.88rem;";
        row.innerHTML = `
          <input type="checkbox" ${is_prev?"checked":""} data-aid="${a.actor_id}" data-pid="${pid}" data-color="${color}" style="accent-color:${color};">
          <span style="background:${color};color:#000;padding:1px 8px;border-radius:8px;font-size:0.8rem;font-weight:600;">${a.name}</span>
          <select class="mp_engine" data-aid="${a.actor_id}" style="background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:0.75rem;margin-left:auto;">
            <option value="">Auto</option>
            <option value="claude">Claude</option>
            <option value="openai">GPT</option>
            <option value="gemini">Gemini</option>
          </select>
          <select class="mp_model" data-aid="${a.actor_id}" style="background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:0.75rem;">
            <option value="">Default</option>
          </select>
        `;
        const _eng_sel = row.querySelector(".mp_engine");
        const _mod_sel = row.querySelector(".mp_model");
        const _upd = async (eid) => {
          const models = await _fetch_mp_models(eid);
          _mod_sel.innerHTML = '<option value="">Default</option>';
          models.forEach(m => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; _mod_sel.appendChild(o); });
        };
        _eng_sel.addEventListener("change", () => _upd(_eng_sel.value));
        if (is_prev && prev_map[a.actor_id]?.engine_id) {
          const prev_eid = prev_map[a.actor_id].engine_id;
          const prev_mid = prev_map[a.actor_id]?.model_id || "";
          setTimeout(() => {
            _eng_sel.value = prev_eid;
            _upd(prev_eid);
            if (prev_mid) _mod_sel.value = prev_mid;
          }, 0);
        } else {
          _upd("");
        }
        sec.appendChild(row);
        color_i++;
      });
      container.appendChild(sec);
    }
  }

  // 参加中セクション
  if (prev_actors.length > 0) {
    const hdr = document.createElement("div");
    hdr.style.cssText = "font-size:0.78rem;color:var(--accent);font-weight:600;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid #333;";
    hdr.textContent = t("inherit_section_prev");
    list_el.appendChild(hdr);
    _render_section(prev_actors, list_el);
  }

  // その他セクション
  if (other_actors.length > 0) {
    const hdr2 = document.createElement("div");
    hdr2.style.cssText = "font-size:0.78rem;color:var(--text_dim);font-weight:600;margin:12px 0 4px;padding-bottom:4px;border-bottom:1px solid #333;";
    hdr2.textContent = t("inherit_section_others");
    list_el.appendChild(hdr2);
    _render_section(other_actors, list_el);
  }

  // 開始ボタン
  modal.querySelector("#inherit_create_btn").addEventListener("click", async () => {
    const checks = modal.querySelectorAll("#inherit_actor_list input[type=checkbox]:checked");
    if (checks.length < 2) {
      alert(t("select_2_or_more"));
      return;
    }
    const participants = [];
    checks.forEach(cb => {
      const engine_sel = modal.querySelector(`.mp_engine[data-aid="${cb.dataset.aid}"]`);
      const model_sel = modal.querySelector(`.mp_model[data-aid="${cb.dataset.aid}"]`);
      participants.push({
        actor_id: parseInt(cb.dataset.aid),
        personal_id: parseInt(cb.dataset.pid),
        color: cb.dataset.color,
        engine_id: engine_sel ? engine_sel.value : "",
        model_id: model_sel ? model_sel.value : "",
        role: "member",
      });
    });
    const conv_mode = modal.querySelector("#inherit_conv_mode").value;
    const opening_msg = modal.querySelector("#inherit_opening_msg").checked;
    modal.remove();

    try {
      const res = await fetch(`/api/chat_thread/${chat_thread_id}/inherit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participants, conversation_mode: conv_mode, opening_message: opening_msg, lang: get_lang() }),
      });
      const result = await res.json();
      if (res.ok) {
        _apply_inherit_result(result);
      }
    } catch (e) {
      console.error("meeting inherit error:", e);
    }
  });
}

// ページ読み込み時にスレッドの状態を確認
async function check_thread_state(thread_id) {
  if (!thread_id) return;
  try {
    const res = await fetch(`/api/chat_thread/${thread_id}/state`);
    const data = await res.json();
    if (data.closed) {
      set_thread_closed_ui(data.summary_500 || "");
    }
  } catch(e) {}
}

// ========== Memory View ==========
btn_memory.addEventListener("click", async () => {
  try {
    const res = await fetch(`/api/memory?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
    const data = await res.json();

    const actor_name = data.actor_info?.name || null;
    const personal_name = data.personal_info?.name || "?";
    const display_name = actor_name || personal_name;
    const sub = actor_name && actor_name !== personal_name ? `（${personal_name}）` : "";
    let summary = `=== ${display_name} ${t("mem_title")}${sub} ===\n\n`;

    summary += `${t("mem_personality")}\n`;
    // actorテーブルの基本情報（traitにないものを補完表示）
    const ai = data.actor_info;
    if (ai) {
      const trait_keys = (data.traits || []).map(tr => tr.trait);
      if (ai.pronoun && !trait_keys.includes("pronoun"))
        summary += `  - ${t("mem_pronoun")}: ${ai.pronoun}\n`;
      if (ai.gender && !trait_keys.includes("gender_identity"))
        summary += `  - ${t("mem_gender")}: ${ai.gender}\n`;
      if (ai.appearance && !trait_keys.includes("self_image"))
        summary += `  - ${t("mem_appearance")}: ${ai.appearance}\n`;
    }
    if (data.traits && data.traits.length > 0) {
      data.traits.forEach(p => {
        const status_mark = p.status === "pending" ? ` ${t("mem_pending")}` : "";
        summary += `  - ${p.label}: ${p.description}${status_mark}\n`;
      });
    } else if (!ai?.pronoun && !ai?.gender && !ai?.appearance) {
      summary += `  ${t("mem_none")}\n`;
    }

    summary += `\n${t("mem_experience")}\n`;
    if (data.experience && data.experience.length > 0) {
      data.experience.slice(0, 5).forEach(e => {
        summary += `  - ${e.abstract || e.content}\n`;
      });
    } else {
      summary += `  ${t("mem_none")}\n`;
    }

    // 長期記憶とエンティティ辞書
    const long_term_items = data.long_term || [];
    const dictionary_items = data.dictionary || [];

    summary += `\n${t("mem_long_term")}\n`;
    if (long_term_items.length > 0) {
      long_term_items.slice(0, 5).forEach(m => {
        summary += `  - [w:${m.weight}] ${m.abstract || m.content}\n`;
      });
    } else {
      summary += `  ${t("mem_none")}\n`;
    }

    summary += `\n${t("mem_dictionary")}\n`;
    if (dictionary_items.length > 0) {
      dictionary_items.slice(0, 10).forEach(m => {
        summary += `  - [w:${m.weight}] ${m.abstract || m.content}\n`;
      });
      if (dictionary_items.length > 10) {
        summary += `  ... ${t("mem_others").replace("{n}", dictionary_items.length - 10)}\n`;
      }
    } else {
      summary += `  ${t("mem_none")}\n`;
    }

    summary += `\n${t("mem_short_term")}\n`;
    if (data.short_term && data.short_term.length > 0) {
      data.short_term.slice(0, 3).forEach(s => {
        summary += `  - ${s.summary}\n`;
      });
    } else {
      summary += `  ${t("mem_none")}\n`;
    }

    summary += `\n${t("mem_cache")}\n`;
    if (data.cache && data.cache.content) {
      summary += `  ${data.cache.content}\n`;
      if (data.cache.updated_at) {
        summary += `  (${t("mem_updated")}: ${data.cache.updated_at.slice(0, 16).replace("T", " ")})\n`;
      }
    } else {
      summary += `  ${t("mem_none")}\n`;
    }

    add_system_message(summary);
  } catch (e) {
    console.error("Memory fetch error:", e);
  }
});

// ========== Line Break Mode ==========

async function load_linebreak_mode() {
  try {
    const res = await fetch("/api/setting/linebreak_mode");
    const data = await res.json();
    if (data.value) {
      linebreak_mode = data.value;
    }
  } catch (e) {
    // デフォルトのまま
  }
  update_linebreak_indicator();
}

async function save_linebreak_mode(mode) {
  linebreak_mode = mode;
  update_linebreak_indicator();
  try {
    await fetch("/api/setting/linebreak_mode", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: mode }),
    });
  } catch (e) {
    console.error("Failed to save linebreak mode:", e);
  }
}

function toggle_linebreak_mode() {
  const next = linebreak_mode === "default" ? "natural" : "default";
  save_linebreak_mode(next);
  const label = next === "default"
    ? t("linebreak_default")
    : t("linebreak_natural");
  add_system_message(label);
}

function update_linebreak_indicator() {
  let indicator = document.getElementById("linebreak_indicator");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.id = "linebreak_indicator";
    const composer = document.querySelector(".composer");
    if (composer) {
      composer.appendChild(indicator);
    }
  }
  indicator.textContent = linebreak_mode === "default" ? "⏎" : "↵";
  indicator.title = linebreak_mode === "default"
    ? t("linebreak_tip_default")
    : t("linebreak_tip_natural");
  indicator.onclick = toggle_linebreak_mode;
}

// ========== Transparency Mode ==========

async function load_transparency_mode() {
  try {
    const res = await fetch("/api/setting/transparency_mode");
    const data = await res.json();
    if (data.value) {
      transparency_mode = data.value;
    }
  } catch (e) {
    // デフォルトのまま (on)
  }
  apply_transparency_mode();
}

async function save_transparency_mode(mode) {
  transparency_mode = mode;
  apply_transparency_mode();
  try {
    await fetch("/api/setting/transparency_mode", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: mode }),
    });
  } catch (e) {
    console.error("Failed to save transparency mode:", e);
  }
}

function apply_transparency_mode() {
  if (transparency_mode === "off") {
    document.body.classList.add("no_transparency");
  } else {
    document.body.classList.remove("no_transparency");
  }
}

function toggle_transparency_mode() {
  const next = transparency_mode === "on" ? "off" : "on";
  save_transparency_mode(next);
  const label = next === "on"
    ? t("tip_transparency_on")
    : t("tip_transparency_off");
  add_system_message(label);
}

// ========== Event Listeners ==========
btn_send.addEventListener("click", send_message);

input_el.addEventListener("keydown", (e) => {
  // IME入力中は無視
  if (e.isComposing) return;

  // Alt+Enter: モード切替
  if (e.key === "Enter" && e.altKey) {
    e.preventDefault();
    toggle_linebreak_mode();
    return;
  }

  if (linebreak_mode === "default") {
    // Enter: 送信 / Shift+Enter: 改行
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send_message();
    }
  } else {
    // Enter: 改行 / Ctrl+Enter: 送信
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      send_message();
    }
  }
});

// ========== Textarea Auto-Expand ==========

function auto_expand_input() {
  input_el.style.height = "auto";
  const max_h = 150;
  input_el.style.height = Math.min(input_el.scrollHeight, max_h) + "px";
  input_el.style.overflowY = input_el.scrollHeight > max_h ? "auto" : "hidden";
}

input_el.addEventListener("input", auto_expand_input);

// ========== Sidebar ==========

function toggle_sidebar() {
  sidebar_el.classList.toggle("is_open");
  const is_open = sidebar_el.classList.contains("is_open");
  // 会議解放通知: サイドバー開→outer非表示、閉→outer再表示（会議ボタン押すまで残す）
  if (is_open) {
    document.querySelectorAll(".meeting_unlock_outer").forEach(el => el.style.display = "none");
  } else {
    document.querySelectorAll(".meeting_unlock_outer").forEach(el => el.style.display = "");
  }
  let overlay = document.querySelector(".sidebar_overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.classList.add("sidebar_overlay");
    document.body.appendChild(overlay);
    overlay.addEventListener("click", toggle_sidebar);
  }
  // サイドバーの状態に明示的に同期（toggleだとズレる場合がある）
  if (is_open) {
    overlay.classList.add("is_visible");
  } else {
    overlay.classList.remove("is_visible");
  }
}

btn_sidebar_toggle.addEventListener("click", toggle_sidebar);
document.getElementById("btn_sidebar_menu")?.addEventListener("click", toggle_sidebar);
document.getElementById("btn_sidebar_search")?.addEventListener("click", () => {
  // サイドバー閉じて検索画面へ
  if (sidebar_el.classList.contains("is_open")) toggle_sidebar();
  show_search_view();
});

async function load_sidebar_chats() {
  try {
    const [actor_res, chat_thread_res] = await Promise.all([
      fetch("/api/actor"),
      fetch("/api/chat_thread_list"),
    ]);
    const actor_data = await actor_res.json();
    const chat_thread_data = await chat_thread_res.json();

    if (!sidebar_chat_list) return;
    sidebar_chat_list.innerHTML = "";

    const actor_list = actor_data.actor || [];
    const chat_thread_list = chat_thread_data.chat_thread_list || [];

    if (chat_thread_list.length === 0) {
      sidebar_chat_list.innerHTML = `<div class="sidebar_chat_item" style="color:var(--text_dim);">${t("no_chats_yet")}</div>`;
      if (sidebar_more_wrap) sidebar_more_wrap.style.display = "none";
      return;
    }

    // actor_id → name / engine のマップ
    const actor_name_map = {};
    const actor_engine_map = {};
    const actor_info_map = {};  // is_unnamed, role_name等の追加情報
    const _sb_default_engine = actor_data.default_engine || "claude";
    actor_list.forEach(a => {
      actor_name_map[a.actor_id] = a.name || t("new_chat_unnamed");
      actor_engine_map[a.actor_id] = a.personal_engine || _sb_default_engine;
      actor_info_map[a.actor_id] = a;
    });

    // サイドバーは最新10件のみ + 「もっと見る」
    const SIDEBAR_LIMIT = 10;
    const sidebar_list = chat_thread_list.slice(0, SIDEBAR_LIMIT);
    if (sidebar_more_wrap) {
      sidebar_more_wrap.style.display = chat_thread_list.length > SIDEBAR_LIMIT ? "" : "none";
    }
    // スレッド一覧用にデータを保持
    window._cached_thread_data = { actor_data, chat_thread_list, actor_name_map, actor_engine_map, actor_info_map, _sb_default_engine };

    sidebar_list.forEach(s => {
      const item = document.createElement("div");
      item.classList.add("sidebar_chat_item");
      if (s.chat_thread_id === chat_thread_id) {
        item.classList.add("is_active");
      }

      // 上段: 極小バッジ + 日時
      const top_row = document.createElement("div");
      top_row.classList.add("sidebar_chat_top");

      const badge = document.createElement("span");
      badge.classList.add("sidebar_badge", "sidebar_badge_mini");
      if (s.chat_mode === "multi") {
        badge.textContent = t("meeting_prefix");
        badge.title = t("meeting_prefix");
        const pc = s.participant_count || 2;
        badge.classList.add(pc % 2 === 0 ? "badge_meeting_even" : "badge_meeting_odd");
      } else {
        const _ai = actor_info_map[s.actor_id] || {};
        const actor_name = actor_name_map[s.actor_id] || "?";
        const max_len = /^[\x00-\x7F]*$/.test(actor_name) ? 12 : 7;
        badge.textContent = actor_name.length <= max_len ? actor_name : actor_name.slice(0, max_len);
        badge.title = actor_name;
        // エンジン別バッジ色（thread_engineを優先、なければactor/デフォルト）
        const _badge_engine = s.thread_engine || actor_engine_map[s.actor_id] || _sb_default_engine;
        const _badge_cls = _badge_engine === "openai" ? "badge_engine_openai"
          : _badge_engine === "gemini" ? "badge_engine_gemini"
          : _badge_engine === "openrouter" ? "badge_engine_openrouter" : "badge_engine_claude";
        badge.classList.add(_badge_cls);
        // モードアクター: role_nameバッジを追加
        if (_ai.is_unnamed && _ai.role_name) {
          const _role_badge = document.createElement("span");
          _role_badge.classList.add("sidebar_badge", "sidebar_badge_mini", "sidebar_badge_role");
          const role_max = /^[\x00-\x7F]*$/.test(_ai.role_name) ? 12 : 7;
          _role_badge.textContent = _ai.role_name.length <= role_max ? _ai.role_name : _ai.role_name.slice(0, role_max);
          _role_badge.title = _ai.role_name;
          badge._role_badge = _role_badge;  // 一時参照
        }
      }

      const date_el = document.createElement("span");
      date_el.classList.add("sidebar_chat_date");
      date_el.textContent = format_sidebar_date(s.last_at);

      top_row.appendChild(badge);
      if (badge._role_badge) top_row.appendChild(badge._role_badge);
      top_row.appendChild(date_el);

      // アーカイブアイコン
      if (s.archived) {
        const arc = document.createElement("span");
        arc.title = t("archive_label");
        arc.style.cssText = "display:inline-flex;align-items:center;margin-left:4px;color:#b8962e;";
        arc.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M21 8H3l1 13h16L21 8z"/><path d="M1 8h22"/><path d="M10 8V5a2 2 0 0 1 4 0v3"/></svg>`;
        top_row.appendChild(arc);
      }

      // 下段: タイトル（編集可能）
      const title_row = document.createElement("div");
      title_row.classList.add("sidebar_chat_title_row");

      const title_text = document.createElement("span");
      title_text.classList.add("sidebar_chat_title");
      title_text.textContent = s.title || s.preview || t("no_conversation");

      const edit_btn = document.createElement("button");
      edit_btn.classList.add("sidebar_edit_btn");
      edit_btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      edit_btn.title = t("tip_edit_title");
      edit_btn.addEventListener("click", (e) => {
        e.stopPropagation();
        start_title_edit(item, s.chat_thread_id, title_text);
      });

      const del_btn = document.createElement("button");
      del_btn.classList.add("sidebar_del_btn");
      del_btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
      del_btn.title = t("tip_delete_chat");
      del_btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        confirm_delete_chat(s.chat_thread_id, s.title || s.preview || t("this_chat"));
      });

      title_row.appendChild(title_text);
      title_row.appendChild(edit_btn);
      if (!s.is_birth) title_row.appendChild(del_btn);

      item.appendChild(top_row);
      item.appendChild(title_row);

      // タグ行
      if (s.tags && s.tags.length > 0) {
        const tag_row = document.createElement("div");
        tag_row.classList.add("sidebar_tag_row");
        s.tags.forEach(tag => {
          const t = document.createElement("span");
          t.classList.add("sidebar_tag");
          t.textContent = tag;
          tag_row.appendChild(t);
        });
        item.appendChild(tag_row);
      }

      // クリックでセッション切替
      item.addEventListener("click", () => {
        if (is_threads_url()) {
          window.location.href = `/chat/${s.chat_thread_id}`;
          return;
        }
        load_chat_thread(s.chat_thread_id);
        toggle_sidebar();
      });

      sidebar_chat_list.appendChild(item);
    });
  } catch (e) {
    console.error("Sidebar load error:", e);
  }
}

// ========== Thread List View（スレッド一覧画面） ==========

function show_thread_list_view() {
  if (!thread_list_view || !thread_list_body) return;
  const cached = window._cached_thread_data;
  if (!cached) return;

  const { chat_thread_list: threads, actor_name_map, actor_engine_map, actor_info_map, _sb_default_engine } = cached;

  _set_topbar_mode("no_chat");
  // ナレッジビューも閉じる
  const kv = document.getElementById("knowledge_view");
  if (kv) kv.style.display = "none";
  // チャットビュー非表示、スレッド一覧表示
  document.querySelector(".chat_wrap").style.display = "none";
  const composer = document.getElementById("composer_dock");
  if (composer) composer.style.display = "none";
  thread_list_view.style.display = "";

  // リスト生成
  thread_list_body.innerHTML = "";
  if (threads.length === 0) {
    thread_list_body.innerHTML = `<div class="thread_list_empty">${t("thread_list_empty")}</div>`;
    return;
  }

  threads.forEach(s => {
    const item = document.createElement("div");
    item.classList.add("tl_item");
    if (s.chat_thread_id === chat_thread_id) item.classList.add("is_active");

    // 上段: バッジ + 日時
    const top = document.createElement("div");
    top.classList.add("tl_top");

    const badge = document.createElement("span");
    badge.classList.add("tl_badge");
    if (s.chat_mode === "multi") {
      badge.textContent = t("meeting_prefix");
      badge.title = t("meeting_prefix");
      const pc = s.participant_count || 2;
      badge.classList.add(pc % 2 === 0 ? "badge_meeting_even" : "badge_meeting_odd");
    } else {
      const actor_name = actor_name_map[s.actor_id] || "?";
      badge.textContent = actor_name;
      badge.title = actor_name;
      const _eng = s.thread_engine || actor_engine_map[s.actor_id] || _sb_default_engine;
      badge.classList.add(_eng === "openai" ? "badge_engine_openai" : _eng === "gemini" ? "badge_engine_gemini" : _eng === "openrouter" ? "badge_engine_openrouter" : "badge_engine_claude");
      // モードアクター: role_nameバッジを追加
      const _tl_ai = (actor_info_map || {})[s.actor_id] || {};
      if (_tl_ai.is_unnamed && _tl_ai.role_name) {
        const _rb = document.createElement("span");
        _rb.classList.add("tl_badge", "sidebar_badge_role");
        _rb.textContent = _tl_ai.role_name;
        _rb.title = _tl_ai.role_name;
        badge._role_badge = _rb;
      }
    }

    const date_el = document.createElement("span");
    date_el.classList.add("tl_date");
    date_el.textContent = format_thread_list_date(s.last_at);

    top.appendChild(badge);
    if (badge._role_badge) top.appendChild(badge._role_badge);
    top.appendChild(date_el);

    if (s.archived) {
      const arc = document.createElement("span");
      arc.classList.add("tl_archived");
      arc.textContent = t("archive_sidebar");
      top.appendChild(arc);
    }

    // メッセージ数
    if (s.message_count) {
      const mc = document.createElement("span");
      mc.classList.add("tl_msg_count");
      mc.textContent = `${s.message_count} ${t("thread_list_messages")}`;
      top.appendChild(mc);
    }

    item.appendChild(top);

    // タイトル行（タイトル + 編集・削除ボタン）
    const title_row = document.createElement("div");
    title_row.classList.add("tl_title_row");

    const title_el = document.createElement("span");
    title_el.classList.add("tl_title");
    title_el.textContent = s.title || s.preview || t("no_conversation");

    const edit_btn = document.createElement("button");
    edit_btn.classList.add("tl_edit_btn");
    edit_btn.title = t("tip_edit_title");
    edit_btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    edit_btn.addEventListener("click", (e) => {
      e.stopPropagation();
      start_tl_title_edit(item, s.chat_thread_id, title_el);
    });

    const del_btn = document.createElement("button");
    del_btn.classList.add("tl_del_btn");
    del_btn.title = t("tip_delete_chat");
    del_btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    del_btn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirm_delete_chat_tl(s.chat_thread_id, s.title || s.preview || t("this_chat"), item);
    });

    title_row.appendChild(title_el);
    title_row.appendChild(edit_btn);
    if (!s.is_birth) title_row.appendChild(del_btn);
    item.appendChild(title_row);

    // プレビュー（タイトルと別なら表示）
    if (s.title && s.preview && s.preview !== s.title) {
      const preview = document.createElement("div");
      preview.classList.add("tl_preview");
      preview.textContent = s.preview;
      item.appendChild(preview);
    }

    // タグ + メッセージ数（下段にまとめる）
    const bottom = document.createElement("div");
    bottom.classList.add("tl_bottom");
    if (s.tags && s.tags.length > 0) {
      s.tags.forEach(tag => {
        const te = document.createElement("span");
        te.classList.add("tl_tag");
        te.textContent = tag;
        bottom.appendChild(te);
      });
    }
    if (bottom.children.length > 0) item.appendChild(bottom);

    // クリック → 実ページ遷移
    item.addEventListener("click", () => {
      window.location.href = `/chat/${s.chat_thread_id}`;
    });

    thread_list_body.appendChild(item);
  });
}

/** スレッド一覧: インラインタイトル編集 */
function start_tl_title_edit(item, thread_id, title_el) {
  const current = title_el.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.classList.add("tl_title_input");
  input.maxLength = 100;

  title_el.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const new_title = input.value.trim();
    if (new_title && new_title !== current) {
      await fetch(`/api/chat_thread/${thread_id}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: new_title }),
      });
    }
    const span = document.createElement("span");
    span.classList.add("tl_title");
    span.textContent = new_title || current;
    input.replaceWith(span);
    // 再クリック用に再接続
    const edit_btn = item.querySelector(".tl_edit_btn");
    if (edit_btn) {
      edit_btn.onclick = (e) => {
        e.stopPropagation();
        start_tl_title_edit(item, thread_id, span);
      };
    }
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = current; input.blur(); }
  });
  input.addEventListener("click", (e) => e.stopPropagation());
}

/** スレッド一覧: 削除（アニメーション付き） */
function confirm_delete_chat_tl(thread_id, label, item_el) {
  const trash_days = window._trash_retention_days || 15;
  open_modal(t("trash_delete_title"), `
    <div style="margin-bottom:16px;">${t("trash_move_confirm").replace("{name}", label).replace("{days}", trash_days)}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="modal_btn_cancel" id="del_cancel_btn">${t("cancel")}</button>
      <button class="modal_btn_danger" id="del_confirm_btn">${t("trash_delete_btn")}</button>
    </div>
  `);
  document.getElementById("del_cancel_btn")?.addEventListener("click", close_modal);
  document.getElementById("del_confirm_btn")?.addEventListener("click", async () => {
    close_modal();
    const res = await fetch(`/api/chat_thread/${thread_id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.status === "ok") {
      // カードをフェードアウトして削除
      item_el.style.transition = "opacity 0.3s, max-height 0.3s";
      item_el.style.opacity = "0";
      item_el.style.maxHeight = item_el.offsetHeight + "px";
      setTimeout(() => {
        item_el.style.maxHeight = "0";
        item_el.style.padding = "0";
        item_el.style.margin = "0";
        item_el.style.overflow = "hidden";
      }, 150);
      setTimeout(() => item_el.remove(), 450);
      // 現在表示中のスレッドだった場合
      if (chat_thread_id === thread_id) {
        chat_thread_id = "";
      }
    }
  });
}

function hide_thread_list_view() {
  if (!thread_list_view) return;
  thread_list_view.style.display = "none";
  document.querySelector(".chat_wrap").style.display = "";
  const composer = document.getElementById("composer_dock");
  if (composer) composer.style.display = "";
  // アーカイブ済みスレッドではcomposerを戻さない
  if (btn_end_chat_thread?.dataset.closed === "true" && composer) composer.style.display = "none";
  _set_topbar_mode(document.querySelector(".new_chat_screen") ? "new_chat" : "chat");
}

// ========== Knowledge View ==========

function show_knowledge_view() {
  const kv = document.getElementById("knowledge_view");
  if (!kv) return;
  hide_thread_list_view();
  hide_search_view();
  _set_topbar_mode("no_chat");
  const cb = document.getElementById("closed_banner");
  if (cb) cb.style.display = "none";
  document.querySelector(".chat_wrap").style.display = "none";
  const composer = document.getElementById("composer_dock");
  if (composer) composer.style.display = "none";
  kv.style.display = "";
  _load_knowledge_list();
}

function hide_knowledge_view() {
  const kv = document.getElementById("knowledge_view");
  if (!kv) return;
  kv.style.display = "none";
  document.querySelector(".chat_wrap").style.display = "";
  const composer = document.getElementById("composer_dock");
  if (composer) composer.style.display = "";
  const _is_archived = btn_end_chat_thread?.dataset.closed === "true";
  const cb = document.getElementById("closed_banner");
  if (cb) cb.style.display = "";
  if (_is_archived && composer) composer.style.display = "none";
  _set_topbar_mode(document.querySelector(".new_chat_screen") ? "new_chat" : "chat");
}

// ナレッジ追加/編集フォームを生成（inline）
function _build_knowledge_form(existing = null) {
  const is_edit = !!existing;
  const el = document.createElement("div");
  el.className = "knowledge_form";
  el.innerHTML = `
    <div class="knowledge_form_field">
      <input type="text" class="knowledge_form_input" id="kf_title" maxlength="100" placeholder="${t("knowledge_form_title")}" value="${_esc(existing?.title || "")}" />
      <span class="knowledge_form_cc" id="kf_cc_title"></span>
    </div>
    <div class="knowledge_form_field">
      <textarea class="knowledge_form_textarea" id="kf_content" rows="6" data-soft-limit="10000" placeholder="${t("knowledge_form_content")}">${_esc(existing?.content || "")}</textarea>
      <span class="knowledge_form_cc" id="kf_cc_content"></span>
    </div>
    <div class="knowledge_form_upload" id="kf_upload_zone">
      <div class="knowledge_upload_progress" id="kf_progress_bar"></div>
      <span class="knowledge_form_upload_label">📎 ${t("knowledge_file_add") || "Add text files"}</span>
      <input type="file" id="kf_file_input" multiple accept=".txt,.md,.csv,.json,.yaml,.yml,.log,.py,.js,.html,.css" style="display:none;" />
      <div class="knowledge_form_upload_status" id="kf_upload_status"></div>
    </div>
    <div class="knowledge_form_shortcut_row">
      <input type="text" class="knowledge_form_input knowledge_form_shortcut_input" id="kf_shortcut" placeholder="${t("knowledge_form_shortcut")}" value="${_esc(existing?.shortcut || "")}" />
      <label class="knowledge_form_magic_label">
        <input type="checkbox" id="kf_is_magic" ${existing?.is_magic ? "checked" : ""} />
        ${t("knowledge_magic_bubble") || "Show in magic word bubbles"}
      </label>
    </div>
    <div class="knowledge_form_hint">${t("knowledge_form_shortcut_hint")}</div>
    <div class="knowledge_form_organize_hint_wrap">
      <input type="text" class="knowledge_form_input" id="kf_organize_hint" placeholder="${t("knowledge_organize_hint") || "Focus: e.g. technical insights, timeline, key decisions..."}" />
    </div>
    <div class="knowledge_form_actions">
      <button class="knowledge_form_save_btn" id="kf_save">${t("knowledge_save")}</button>
      <div class="knowledge_form_organize_wrap">
        <select class="knowledge_form_engine_select" id="kf_organize_engine"></select>
        <select class="knowledge_form_engine_select" id="kf_organize_model">
          <option value="">Default</option>
        </select>
        <button class="knowledge_form_organize_btn" id="kf_organize">✨ ${t("knowledge_organize") || "Organize"}</button>
      </div>
      <button class="knowledge_form_datasource_btn" id="kf_save_as_data" style="display:none;">📂 ${t("knowledge_save_as_data") || "Save as data source"}</button>
      <button class="knowledge_form_cancel_btn" id="kf_cancel">${t("knowledge_cancel")}</button>
    </div>
  `;
  // 文字数カウンター + ソフトリミット
  const save_btn = el.querySelector("#kf_save");
  for (const [inputId, ccId] of [["kf_title", "kf_cc_title"], ["kf_content", "kf_cc_content"]]) {
    const input = el.querySelector("#" + inputId);
    const cc = el.querySelector("#" + ccId);
    if (!input || !cc) continue;
    const max = parseInt(input.getAttribute("maxlength") || input.getAttribute("data-soft-limit") || "0");
    const is_soft = !!input.getAttribute("data-soft-limit");
    const HARD_LIMIT = 50000;
    const update = () => {
      const len = input.value.length;
      cc.textContent = `(${len}/${max})`;
      cc.classList.toggle("near_limit", len >= max * 0.8 && len < max);
      cc.classList.toggle("at_limit", len >= max && len <= HARD_LIMIT);
      cc.classList.toggle("over_limit", is_soft && len > max);
      // content のソフトリミットのみで保存/データソースボタンを制御
      if (is_soft) {
        const ds_btn = el.querySelector("#kf_save_as_data");
        const organize_wrap = el.querySelector(".knowledge_form_organize_hint_wrap");
        const organize_actions = el.querySelector(".knowledge_form_organize_wrap");
        if (len > HARD_LIMIT) {
          // > 50000: データソースのみ
          cc.textContent = `(${len}) — ${t("knowledge_datasource_only") || "Too large. Save as data source."}`;
          if (save_btn) save_btn.style.display = "none";
          if (organize_wrap) organize_wrap.style.display = "none";
          if (organize_actions) organize_actions.style.display = "none";
          if (ds_btn) ds_btn.style.display = "";
        } else if (len > max) {
          // 10001〜50000: 整理 or データソース
          cc.textContent = `(${len}/${max}) — ${t("knowledge_over_limit") || "Organize or save as data source"}`;
          if (save_btn) { save_btn.disabled = true; save_btn.style.display = ""; }
          if (organize_wrap) organize_wrap.style.display = "";
          if (organize_actions) organize_actions.style.display = "";
          if (ds_btn) ds_btn.style.display = "";
        } else {
          // ≤ 10000: 通常
          if (save_btn) { save_btn.disabled = false; save_btn.style.display = ""; }
          if (organize_wrap) organize_wrap.style.display = "";
          if (organize_actions) organize_actions.style.display = "";
          if (ds_btn) ds_btn.style.display = "none";
        }
      }
    };
    input.addEventListener("input", update);
    update();
  }

  // ファイルアップロード（テキスト追加）
  const _uploaded_hashes = new Set();
  const upload_zone = el.querySelector("#kf_upload_zone");
  const file_input = el.querySelector("#kf_file_input");
  const upload_status = el.querySelector("#kf_upload_status");
  const content_ta = el.querySelector("#kf_content");

  async function _hash_text(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }

  const _READABLE_EXT = new Set([".txt",".md",".csv",".json",".yaml",".yml",".log",".py",".js",".html",".css",".xml",".toml"]);
  let _upload_log = [];

  function _update_upload_log() {
    if (!upload_status) return;
    upload_status.innerHTML = _upload_log.map(l =>
      `<div class="knowledge_upload_log_line ${l.status}">${_esc(l.name)}: ${l.msg}</div>`
    ).join("");
    // 最新を見えるようにスクロール
    upload_status.scrollTop = upload_status.scrollHeight;
  }

  const progress_bar = el.querySelector("#kf_progress_bar");
  function _update_progress(current, total) {
    if (!progress_bar) return;
    if (total <= 0 || current >= total) {
      progress_bar.style.width = "0";
      return;
    }
    const pct = Math.round((current / total) * 100);
    progress_bar.style.width = pct + "%";
  }

  async function _handle_files(files) {
    let added = 0;
    const total = files.length || files.size || 0;
    let processed = 0;
    const _large_batch = []; // 100KB超のファイルをまとめる
    for (const file of files) {
      processed++;
      _update_progress(processed, total);
      const ext = "." + file.name.split(".").pop().toLowerCase();
      // 読めないファイルタイプ
      if (!_READABLE_EXT.has(ext)) {
        _upload_log.push({ name: file.name, status: "skip", msg: t("knowledge_file_unsupported") || "unsupported format" });
        _update_upload_log();
        continue;
      }
      try {
        // 大きいファイル（100KB超）はバッチに溜めて後でまとめてデータソースへ
        if (file.size > 100000) {
          _upload_log.push({ name: file.name, status: "info", msg: `${_salvage_format_size(file.size)} → ${t("knowledge_file_too_large") || "sending to data source..."}` });
          _update_upload_log();
          const text = await file.text();
          if (text.trim()) _large_batch.push({ filename: file.name, content: text });
          continue;
        }
        const text = await file.text();
        const trimmed = text.trim();
        if (!trimmed) {
          _upload_log.push({ name: file.name, status: "skip", msg: t("knowledge_file_empty") || "empty" });
          _update_upload_log();
          continue;
        }
        const h = await _hash_text(trimmed);
        if (_uploaded_hashes.has(h)) {
          _upload_log.push({ name: file.name, status: "dup", msg: t("knowledge_file_duplicate") || "already applied" });
          _update_upload_log();
          continue;
        }
        _uploaded_hashes.add(h);
        const sep = content_ta.value.trim() ? "\n\n" : "";
        content_ta.value += sep + trimmed;
        content_ta.dispatchEvent(new Event("input"));
        added++;
        _upload_log.push({ name: file.name, status: "ok", msg: t("knowledge_file_added") || "added" });
      } catch(e) {
        _upload_log.push({ name: file.name, status: "skip", msg: t("knowledge_file_read_error") || "read error" });
      }
      _update_upload_log();
    }
    // 大きいファイルをまとめてデータソースに保存
    if (_large_batch.length > 0) {
      try {
        const _ds_res = await fetch("/api/salvage/save_batch", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ source_name: "", files: _large_batch }),
        });
        const _ds_data = await _ds_res.json();
        if (_ds_data.status === "ok") {
          for (const f of _large_batch) {
            _upload_log.push({ name: f.filename, status: "ok", msg: t("knowledge_file_sent_datasource") || "saved as data source" });
          }
          window._salvage_highlight_source = _ds_data.source_name;
        }
      } catch(e2) {
        for (const f of _large_batch) {
          _upload_log.push({ name: f.filename, status: "skip", msg: t("knowledge_file_read_error") || "save error" });
        }
      }
      _update_upload_log();
    }
    // プログレスリセット + サマリー行
    _update_progress(0, 0);
    if (total > 1) {
      const skipped = total - added;
      _upload_log.push({ name: "---", status: "info",
        msg: `${added} ${t("knowledge_file_added") || "added"}` + (skipped > 0 ? ` / ${skipped} skipped` : "")
      });
      _update_upload_log();
    }
  }

  // フォルダ再帰読み取り（ドロップ対応）
  const _TEXT_EXT = new Set([".txt",".md",".csv",".json",".yaml",".yml",".log",".py",".js",".html",".css",".xml",".toml"]);
  async function _read_entry_recursive(entry) {
    const files = [];
    if (entry.isFile) {
      const file = await new Promise(r => entry.file(r));
      const ext = "." + file.name.split(".").pop().toLowerCase();
      if (_TEXT_EXT.has(ext)) files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise(r => reader.readEntries(r));
      for (const e of entries) {
        files.push(...await _read_entry_recursive(e));
      }
    }
    return files;
  }

  // ドロップ処理（フォーム全体 + upload_zone 両方で受ける）
  async function _handle_drop(e) {
    e.preventDefault();
    el.classList.remove("dragover");
    upload_zone?.classList.remove("dragover");
      // フォルダドロップ対応
      const items = e.dataTransfer.items;
      if (items && items.length > 0 && items[0].webkitGetAsEntry) {
        const all_files = [];
        for (const item of items) {
          const entry = item.webkitGetAsEntry();
          if (entry) all_files.push(...await _read_entry_recursive(entry));
        }
        if (all_files.length > 0) {
          if (upload_status) upload_status.textContent = `${all_files.length} ${t("knowledge_file_found") || "files found"}...`;
          await _handle_files(all_files);
          return;
        }
      }
    // フォールバック: 通常のファイルドロップ
    _handle_files(e.dataTransfer.files);
  }

  // フォーム全体でドラッグ&ドロップ受付
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dragover"); });
  el.addEventListener("dragleave", (e) => { if (e.target === el) el.classList.remove("dragover"); });
  el.addEventListener("drop", _handle_drop);

  if (upload_zone && file_input) {
    upload_zone.addEventListener("click", () => file_input.click());
    file_input.addEventListener("change", (e) => _handle_files(e.target.files));
  }

  // エンジン→モデル連動（APIキー設定済みのみ表示）
  const organize_engine_sel = el.querySelector("#kf_organize_engine");
  const organize_model_sel = el.querySelector("#kf_organize_model");
  if (organize_engine_sel && organize_model_sel) {
    const _update_models = async (eid) => {
      const models = await _fetch_mp_models(eid);
      organize_model_sel.innerHTML = '<option value="">Default</option>';
      models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id; opt.textContent = m.label;
        organize_model_sel.appendChild(opt);
      });
    };
    organize_engine_sel.addEventListener("change", () => _update_models(organize_engine_sel.value));
    // APIキー状況を取得して利用可能エンジンだけ表示
    fetch("/api/api_key_status").then(r => r.json()).then(status => {
      const _engine_labels = { claude: "Claude", openai: "GPT", gemini: "Gemini" };
      let first_engine = "";
      for (const eid of ["gemini", "claude", "openai"]) {
        if (status[eid]) {
          const opt = document.createElement("option");
          opt.value = eid; opt.textContent = _engine_labels[eid];
          organize_engine_sel.appendChild(opt);
          if (!first_engine) first_engine = eid;
        }
      }
      if (first_engine) _update_models(first_engine);
    }).catch(() => {
      // フォールバック: 全エンジン表示
      for (const [eid, label] of [["gemini","Gemini"],["claude","Claude"],["openai","GPT"]]) {
        const opt = document.createElement("option");
        opt.value = eid; opt.textContent = label;
        organize_engine_sel.appendChild(opt);
      }
      _update_models("gemini");
    });
  }

  // AI整理ボタン
  const organize_btn = el.querySelector("#kf_organize");
  if (organize_btn && content_ta) {
    let _before_organize = "";
    organize_btn.addEventListener("click", async () => {
      const text = content_ta.value.trim();
      if (!text) return;
      _before_organize = text;
      organize_btn.disabled = true;
      organize_btn.textContent = "✨ ...";
      try {
        const engine = organize_engine_sel?.value || "gemini";
        const model = organize_model_sel?.value || "";
        const hint = el.querySelector("#kf_organize_hint")?.value?.trim() || "";
        const res = await fetch("/api/knowledge/organize", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ content: text, engine, model, hint }),
        });
        const data = await res.json();
        if (data.organized) {
          content_ta.value = data.organized;
          content_ta.dispatchEvent(new Event("input"));
          // 「元に戻す」ボタンを表示
          if (!el.querySelector(".knowledge_form_undo_btn")) {
            const undo = document.createElement("button");
            undo.className = "knowledge_form_undo_btn";
            undo.textContent = t("knowledge_organize_undo") || "Undo";
            undo.addEventListener("click", () => {
              content_ta.value = _before_organize;
              content_ta.dispatchEvent(new Event("input"));
              undo.remove();
            });
            organize_btn.parentElement.appendChild(undo);
          }
        }
      } catch(e) { console.error("organize error", e); }
      organize_btn.disabled = false;
      organize_btn.textContent = "✨ " + (t("knowledge_organize") || "Organize");
    });
  }

  // データソースとして保存ボタン
  const ds_btn = el.querySelector("#kf_save_as_data");
  if (ds_btn && content_ta) {
    ds_btn.addEventListener("click", async () => {
      const title = el.querySelector("#kf_title")?.value?.trim() || "";
      const display_title = title || t("knowledge_no_title") || "(no title)";
      const content = content_ta.value.trim();
      if (!content) return;
      ds_btn.disabled = true;
      ds_btn.textContent = "📂 ...";
      try {
        const res = await fetch("/api/salvage/save_as_data", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({ title, content }),
        });
        const data = await res.json();
        if (data.status === "ok") {
          content_ta.value = "";
          content_ta.dispatchEvent(new Event("input"));
          el.querySelector("#kf_title").value = "";
          el.querySelector("#kf_title")?.dispatchEvent(new Event("input"));
          el.querySelector("#kf_shortcut").value = "";
          _upload_log = [];
          _uploaded_hashes.clear();
          _update_upload_log();
          // フォームの外に保存完了メッセージ + データソースへのリンク
          document.querySelectorAll(".knowledge_form_ds_result").forEach(r => r.remove());
          const result_el = document.createElement("div");
          result_el.className = "knowledge_form_ds_result";
          el.after(result_el);
          const msg = (t("knowledge_saved_as_data") || "Saved as data source: {name}").replace("{name}", display_title);
          result_el.innerHTML = `
            <div class="knowledge_ds_result_msg">${msg}</div>
            <button class="knowledge_ds_result_link" id="kf_goto_datasource">${t("knowledge_goto_datasource") || "View in data sources"} →</button>
          `;
          const _saved_source = data.source_name || "knowledge_import";
          result_el.querySelector("#kf_goto_datasource")?.addEventListener("click", () => {
            window._salvage_highlight_source = _saved_source;
            _salvage_show_view();
          });
        }
      } catch(e) { console.error("save_as_data error", e); }
      ds_btn.disabled = false;
      ds_btn.textContent = "📂 " + (t("knowledge_save_as_data") || "Save as data source");
    });
  }

  return el;
}

function _validate_shortcut(s) {
  if (!s) return null; // 空はOK（任意項目）
  if (s.startsWith("_")) return t("knowledge_shortcut_no_underscore") || "Cannot start with _";
  if (/[\s#!@$%^&*()+={}\[\]|\\/<>,.?;:\"'`]/.test(s)) return t("knowledge_shortcut_no_symbols") || "Symbols not allowed";
  return null;
}

async function _save_knowledge_from_form(knowledge_id = null) {
  const title = document.getElementById("kf_title")?.value?.trim();
  const content = document.getElementById("kf_content")?.value?.trim();
  const shortcut = document.getElementById("kf_shortcut")?.value?.trim() || null;
  const is_magic = document.getElementById("kf_is_magic")?.checked ? 1 : 0;
  if (!title || !content) return;
  const sc_err = _validate_shortcut(shortcut);
  if (sc_err) {
    const hint = document.getElementById("kf_shortcut")?.closest(".knowledge_form_shortcut_row")?.nextElementSibling;
    if (hint) { hint.textContent = sc_err; hint.style.color = "#e55"; }
    return;
  }
  try {
    if (knowledge_id) {
      await fetch("/api/knowledge/" + knowledge_id, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ title, content, shortcut, is_magic }),
      });
    } else {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ title, content, shortcut, is_magic }),
      });
    }
    _load_knowledge_list();
    _load_knowledge_magic_chips();
  } catch(e) { console.error("knowledge save error", e); }
}

async function _load_knowledge_list() {
  const body = document.getElementById("knowledge_body");
  if (!body) return;
  body.innerHTML = "";
  try {
    const res = await fetch("/api/knowledge");
    const data = await res.json();
    const items = data.items || [];

    // 「+追加」ボタン（常に表示）
    const add_btn = document.createElement("button");
    add_btn.className = "knowledge_add_btn";
    add_btn.textContent = t("knowledge_add");
    const _close_add_form = () => {
      const form = body.querySelector(".knowledge_form:not([data-edit])");
      if (form) form.remove();
      add_btn.classList.remove("as_title");
      add_btn.textContent = t("knowledge_add");
    };
    add_btn.addEventListener("click", () => {
      // トグル: フォームが既にあれば閉じる
      if (body.querySelector(".knowledge_form:not([data-edit])")) {
        _close_add_form();
        return;
      }
      const form = _build_knowledge_form();
      add_btn.after(form);
      add_btn.classList.add("as_title");
      add_btn.textContent = t("knowledge_add_title") || "New Knowledge";
      form.querySelector("#kf_title")?.focus();
      form.querySelector("#kf_save")?.addEventListener("click", () => _save_knowledge_from_form());
      form.querySelector("#kf_cancel")?.addEventListener("click", _close_add_form);
    });
    body.appendChild(add_btn);

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "knowledge_empty";
      empty.textContent = t("knowledge_empty");
      body.appendChild(empty);
      return;
    }
    // マジックワードヒント表示
    const magic_items = items.filter(i => i.is_magic && i.shortcut);
    if (magic_items.length > 0) {
      const hint_el = document.createElement("div");
      hint_el.className = "knowledge_magic_hint";
      hint_el.innerHTML = `<span class="knowledge_magic_label">${t("knowledge_magic_words")}</span> ` +
        magic_items.map(m => `<code class="knowledge_magic_tag">#${_esc(m.shortcut)}</code>`).join(" ");
      body.appendChild(hint_el);
    }

    items.forEach(item => {
      const el = document.createElement("div");
      el.classList.add("knowledge_item");
      el.dataset.kid = item.id;
      const is_sys = item.is_system === 1;
      const badge_class = is_sys ? "system" : "user";
      const badge_text = is_sys ? t("knowledge_system") : t("knowledge_user");
      const preview = (item.content || "").slice(0, 120).replace(/\n/g, " ");
      const updated = item.updated_at ? format_thread_list_date(item.updated_at) : "";
      const shortcut_badge = item.shortcut ? `<code class="knowledge_shortcut_tag">#${_esc(item.shortcut)}</code>` : "";

      const key_label = item.key ? `<span class="knowledge_item_key">${_esc(item.key)}</span>` : "";

      el.innerHTML = `
        <div class="knowledge_item_header">
          <span class="knowledge_item_title">${_esc(item.title)}</span>
          ${shortcut_badge}
          <span class="knowledge_item_badge ${badge_class}">${badge_text}</span>
        </div>
        <div class="knowledge_item_meta">${key_label} ${_esc(item.category)} · ${updated}</div>
        <div class="knowledge_item_preview" id="kp_${item.id}" style="max-height:60px;overflow:hidden;">${_esc(preview)}…</div>
        <div class="knowledge_item_actions">
          <button class="knowledge_toggle_btn" data-kid="${item.id}">${t("knowledge_expand")}</button>
          ${!is_sys ? `<button class="knowledge_edit_btn" data-kid="${item.id}">${t("knowledge_edit")}</button>` : ""}
          ${!is_sys ? `<button class="knowledge_delete_btn" data-kid="${item.id}">${t("knowledge_delete")}</button>` : ""}
        </div>
      `;
      body.appendChild(el);

      // 展開/閉じるボタン
      el.querySelector(".knowledge_toggle_btn")?.addEventListener("click", function() {
        const pv = document.getElementById("kp_" + this.dataset.kid);
        if (!pv) return;
        if (pv.style.maxHeight === "none") {
          pv.style.maxHeight = "60px";
          pv.style.overflow = "hidden";
          pv.textContent = (item.content || "").slice(0, 120).replace(/\n/g, " ") + "…";
          this.textContent = t("knowledge_expand");
        } else {
          pv.style.maxHeight = "none";
          pv.style.overflow = "visible";
          pv.textContent = item.content || "";
          this.textContent = t("knowledge_collapse");
        }
      });

      // 編集ボタン（ユーザーナレッジのみ）
      el.querySelector(".knowledge_edit_btn")?.addEventListener("click", function() {
        body.querySelectorAll(".knowledge_form").forEach(f => f.remove());
        _close_add_form();
        const form = _build_knowledge_form(item);
        form.dataset.edit = "1";
        el.after(form);
        form.querySelector("#kf_title")?.focus();
        form.querySelector("#kf_save")?.addEventListener("click", () => _save_knowledge_from_form(item.id));
        form.querySelector("#kf_cancel")?.addEventListener("click", () => form.remove());
      });

      // 削除ボタン
      el.querySelector(".knowledge_delete_btn")?.addEventListener("click", async function() {
        if (!confirm(t("knowledge_confirm_delete"))) return;
        try {
          const dr = await fetch("/api/knowledge/" + encodeURIComponent(this.dataset.kid), { method: "DELETE" });
          const dd = await dr.json();
          if (dd.status === "ok") {
            el.remove();
            if (!body.querySelector(".knowledge_item")) {
              const empty = document.createElement("div");
              empty.className = "knowledge_empty";
              empty.textContent = t("knowledge_empty");
              body.appendChild(empty);
            }
          }
        } catch(e) { console.error("knowledge delete error", e); }
      });
    });
  } catch(e) {
    console.error("knowledge load error", e);
    body.innerHTML = `<div class="knowledge_empty">Error loading knowledge</div>`;
  }
}

// ナレッジボタン（サイドバー）
document.getElementById("btn_knowledge")?.addEventListener("click", () => {
  if (sidebar_el.classList.contains("is_open")) toggle_sidebar();
  show_knowledge_view();
  history.pushState({}, "", "/knowledge");
});

// ナレッジ戻るボタン
document.getElementById("btn_knowledge_back")?.addEventListener("click", () => {
  hide_knowledge_view();
  history.pushState({}, "", "/");
});


// ========== サルベージエンジン（データソース管理）β ==========
// 有料オプション前提・取り外し可能。ナレッジ画面のサブビュー。

let _salvage_enabled = true; // /api/salvage/status で更新

async function _salvage_check_status() {
  try {
    const res = await fetch("/api/salvage/status");
    const data = await res.json();
    _salvage_enabled = data.enabled;
    const wrap = document.getElementById("salvage_btn_wrap");
    if (wrap) wrap.style.display = _salvage_enabled ? "" : "none";
  } catch(e) {
    _salvage_enabled = false;
  }
}

function _salvage_show_view() {
  const sv = document.getElementById("salvage_view");
  const kb = document.getElementById("knowledge_body");
  const bw = document.getElementById("salvage_btn_wrap");
  const kh = document.querySelector(".knowledge_header");
  if (!sv) return;
  if (kb) kb.style.display = "none";
  if (bw) bw.style.display = "none";
  if (kh) kh.style.display = "none";
  sv.style.display = "";
  _salvage_load_sources();
}

function _salvage_hide_view() {
  const sv = document.getElementById("salvage_view");
  const kb = document.getElementById("knowledge_body");
  const bw = document.getElementById("salvage_btn_wrap");
  const kh = document.querySelector(".knowledge_header");
  if (sv) sv.style.display = "none";
  if (kb) kb.style.display = "";
  if (bw && _salvage_enabled) bw.style.display = "";
  if (kh) kh.style.display = "";
  document.getElementById("salvage_status_msg").textContent = "";
}

function _salvage_format_size(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

async function _salvage_load_sources() {
  const list = document.getElementById("salvage_source_list");
  if (!list) return;
  list.innerHTML = "";
  try {
    // APIキー状況を取得してエンジン選択肢を動的生成
    let _salvage_avail_engines = [];
    try {
      const kr = await fetch("/api/api_key_status");
      const ks = await kr.json();
      // 順序: GPT → Gemini → Claude（コスト安い順）
      for (const eid of ["openai", "gemini", "claude"]) {
        if (ks[eid]) _salvage_avail_engines.push(eid);
      }
    } catch(e) { _salvage_avail_engines = ["openai", "gemini", "claude"]; }
    const _engine_labels = { openai: "GPT", gemini: "★ Gemini", claude: "Claude" };
    const _engine_options_html = _salvage_avail_engines.map(eid =>
      `<option value="${eid}">${_engine_labels[eid]}</option>`
    ).join("");

    const res = await fetch("/api/salvage/status");
    const data = await res.json();
    const sources = data.sources || [];
    if (sources.length === 0) {
      list.innerHTML = `<div class="salvage_empty">${t("salvage_empty")}</div>`;
      return;
    }
    // ソート
    const sort_key = document.getElementById("salvage_sort_select")?.value || "date_desc";
    sources.sort((a, b) => {
      switch (sort_key) {
        case "date_desc": return (b.first_added || b.last_scanned || "").localeCompare(a.first_added || a.last_scanned || "");
        case "date_asc":  return (a.first_added || a.last_scanned || "").localeCompare(b.first_added || b.last_scanned || "");
        case "name_asc":  return (a.source_name || "").localeCompare(b.source_name || "");
        case "name_desc": return (b.source_name || "").localeCompare(a.source_name || "");
        case "size_desc": return (b.total_size || 0) - (a.total_size || 0);
        case "size_asc":  return (a.total_size || 0) - (b.total_size || 0);
        default: return 0;
      }
    });
    sources.forEach(src => {
      const el = document.createElement("div");
      el.className = "salvage_source_item";
      const last_scan = src.last_scanned
        ? format_thread_list_date(src.last_scanned)
        : t("salvage_not_scanned");
      const first_added = src.first_added
        ? format_thread_list_date(src.first_added)
        : "";
      const show_added = first_added && first_added !== last_scan;
      el.innerHTML = `
        <div class="salvage_source_header">
          <span class="salvage_source_name">${_esc(src.source_name)}</span>
          <button class="salvage_rename_btn" data-source="${_esc(src.source_name)}" title="${t("salvage_rename") || "Rename"}"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="salvage_open_folder_btn" data-source="${_esc(src.source_name)}" title="${t("salvage_open_folder") || "Open folder"}"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
        </div>
        <div class="salvage_source_meta">
          <span>${t("salvage_files")}: ${src.file_count}</span>
          <span>${t("salvage_size")}: ${_salvage_format_size(src.total_size)}</span>
          ${show_added ? `<span>${t("salvage_added") || "Added"}: ${first_added}</span>` : ""}
          <span>${t("salvage_last_scan")}: ${last_scan}</span>
        </div>
        <div class="salvage_file_list" id="salvage_files_${_esc(src.source_name)}" style="display:none;"></div>
        <div class="salvage_source_actions">
          ${src.file_count > 0 ? `
            <div class="salvage_knowledgize_wrap">
              <select class="salvage_engine_select" data-source="${_esc(src.source_name)}">
                ${_engine_options_html}
              </select>
              <button class="salvage_knowledgize_btn" data-source="${_esc(src.source_name)}">⚡ ${t("salvage_knowledgize") || "Knowledgize"}</button>
            </div>
            <button class="salvage_source_delete_btn" data-source="${_esc(src.source_name)}"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> ${t("salvage_delete_source")}</button>
          ` : ""}
        </div>
      `;
      list.appendChild(el);

      // ハイライト（ナレッジフォームからの遷移時）
      if (window._salvage_highlight_source === src.source_name) {
        el.classList.add("salvage_source_highlight");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          el.classList.remove("salvage_source_highlight");
          el.classList.add("salvage_source_highlight_stay");
        }, 4000);
        window._salvage_highlight_source = null;
      }

      // ソースクリックでファイル一覧展開
      el.querySelector(".salvage_source_name")?.addEventListener("click", () => {
        _salvage_toggle_files(src.source_name, el);
      });

      // リネームボタン → インライン編集
      el.querySelector(".salvage_rename_btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const name_el = el.querySelector(".salvage_source_name");
        if (!name_el || name_el.tagName === "INPUT") return;
        const old_name = name_el.textContent;
        const input = document.createElement("input");
        input.type = "text";
        input.value = old_name;
        input.className = "salvage_source_name_input";
        input.maxLength = 100;
        name_el.replaceWith(input);
        input.focus();
        input.select();

        const save = async () => {
          const new_name = input.value.trim();
          if (new_name && new_name !== old_name) {
            try {
              const res = await fetch("/api/salvage/source/" + encodeURIComponent(old_name) + "/rename", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({ new_name: new_name }),
              });
              const data = await res.json();
              if (data.status === "ok") { window._salvage_highlight_source = new_name; _salvage_load_sources(); return; }
            } catch(err) { console.error("rename error", err); }
          }
          const span = document.createElement("span");
          span.className = "salvage_source_name";
          span.textContent = new_name || old_name;
          input.replaceWith(span);
        };
        input.addEventListener("blur", save);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
          if (ev.key === "Escape") { input.value = old_name; input.blur(); }
        });
        input.addEventListener("click", (ev) => ev.stopPropagation());
      });

      // フォルダを開くボタン
      el.querySelector(".salvage_open_folder_btn")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const source = e.target.closest("button").dataset.source;
        try { await fetch("/api/salvage/open_folder/" + encodeURIComponent(source), { method: "POST" }); } catch(err) { console.error("open folder error", err); }
      });

      // ナレッジ化ボタン
      el.querySelector(".salvage_knowledgize_btn")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.target;
        const source = btn.dataset.source;
        const select = el.querySelector(".salvage_engine_select");
        const engine = select?.value || "gemini";
        const msg = document.getElementById("salvage_status_msg");
        btn.disabled = true;
        btn.textContent = "⚡ ...";
        if (msg) msg.textContent = t("salvage_knowledgizing") || "Analyzing...";
        try {
          const res = await fetch("/api/salvage/knowledgize", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ source_name: source, engine }),
          });
          const data = await res.json();
          if (data.status === "ok") {
            const txt = (t("salvage_knowledgize_done") || "Created {n} knowledge items")
              .replace("{n}", data.created);
            if (msg) msg.textContent = txt;
          } else {
            if (msg) msg.textContent = data.detail || data.error || "Error";
          }
        } catch(err) {
          console.error("knowledgize error", err);
          if (msg) msg.textContent = "Error";
        }
        btn.disabled = false;
        btn.textContent = "⚡ " + (t("salvage_knowledgize") || "Knowledgize");
      });

      // 削除ボタン
      el.querySelector(".salvage_source_delete_btn")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(t("salvage_confirm_delete_source"))) return;
        try {
          await fetch("/api/salvage/source/" + encodeURIComponent(src.source_name), { method: "DELETE" });
          _salvage_load_sources();
        } catch(err) { console.error("salvage delete source error", err); }
      });
    });
  } catch(e) {
    console.error("salvage sources load error", e);
    list.innerHTML = `<div class="salvage_empty">Error loading sources</div>`;
  }
}

async function _salvage_toggle_files(source_name, parentEl) {
  const fl = parentEl.querySelector(".salvage_file_list");
  if (!fl) return;
  if (fl.style.display !== "none") {
    fl.style.display = "none";
    fl.innerHTML = "";
    return;
  }
  fl.style.display = "";
  fl.innerHTML = "...";
  try {
    const res = await fetch("/api/salvage/data?source_name=" + encodeURIComponent(source_name));
    const data = await res.json();
    const items = data.data || data.items || [];
    if (items.length === 0) {
      fl.innerHTML = `<div class="salvage_empty" style="padding:8px 0;font-size:0.75rem;">${t("salvage_not_scanned")}</div>`;
      return;
    }
    fl.innerHTML = "";
    items.forEach(item => {
      const fe = document.createElement("div");
      fe.className = "salvage_file_item";
      const status_class = item.status || "raw";
      const preview = (item.content_summary || "").slice(0, 1000).replace(/\n/g, " ");
      const ref_badge = item.is_file_ref ? `<span class="salvage_file_ref_badge" title="Full content in file">FILE</span>` : "";
      fe.innerHTML = `
        <div class="salvage_file_header">
          <span class="salvage_file_name" title="${_esc(item.source_path)}">${_esc(item.filename)}</span>
          <span class="salvage_file_size">${_salvage_format_size(item.file_size)}</span>
          ${ref_badge}
          <span class="salvage_file_status_badge ${status_class}">${_esc(item.status)}</span>
          <button class="salvage_file_delete_btn" data-id="${item.id}" title="Delete">x</button>
        </div>
        ${preview ? `<div class="salvage_file_preview">${_esc(preview.slice(0, 200))}${preview.length > 200 ? "…" : ""}</div>` : ""}
      `;
      fl.appendChild(fe);
      // プレビュークリックで展開/閉じる
      const pv_el = fe.querySelector(".salvage_file_preview");
      if (pv_el && preview.length > 200) {
        pv_el.style.cursor = "pointer";
        pv_el.addEventListener("click", () => {
          if (pv_el.dataset.expanded === "1") {
            pv_el.textContent = preview.slice(0, 200) + "…";
            pv_el.dataset.expanded = "";
          } else {
            pv_el.textContent = preview;
            pv_el.dataset.expanded = "1";
          }
        });
      }
      fe.querySelector(".salvage_file_delete_btn")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await fetch("/api/salvage/data/" + item.id, { method: "DELETE" });
          fe.remove();
        } catch(err) { console.error("salvage file delete error", err); }
      });
    });
  } catch(e) {
    fl.innerHTML = `<div class="salvage_empty" style="padding:8px 0;">Error</div>`;
  }
}

// スキャンボタン
document.getElementById("btn_salvage_scan")?.addEventListener("click", async function() {
  const btn = this;
  const msg = document.getElementById("salvage_status_msg");
  btn.disabled = true;
  btn.textContent = t("salvage_scanning");
  if (msg) msg.textContent = "";
  try {
    const res = await fetch("/api/salvage/scan", { method: "POST" });
    const data = await res.json();
    if (data.status === "ok") {
      const txt = t("salvage_scan_done").replace("${new}", data.new).replace("${updated}", data.updated);
      if (msg) msg.textContent = txt;
      _salvage_load_sources();
    } else {
      if (msg) msg.textContent = t("salvage_scan_error") + ": " + (data.message || "");
    }
  } catch(e) {
    if (msg) msg.textContent = t("salvage_scan_error");
  }
  btn.disabled = false;
  btn.textContent = t("salvage_scan");
});

// データソースのソート変更
document.getElementById("salvage_sort_select")?.addEventListener("change", () => _salvage_load_sources());

// データソースのルートフォルダを開く
document.getElementById("btn_salvage_open_root")?.addEventListener("click", async () => {
  try { await fetch("/api/salvage/open_folder", { method: "POST" }); } catch(e) { console.error("open root folder error", e); }
});

// データソース追加ドロップゾーン
{
  const _dz = document.getElementById("salvage_add_dropzone");
  const _fi = document.getElementById("salvage_add_file_input");
  const _TEXT_EXT_DS = new Set([".txt",".md",".csv",".json",".yaml",".yml",".log",".py",".js",".html",".css",".xml",".toml"]);

  async function _ds_read_entry(entry) {
    const files = [];
    if (entry.isFile) {
      const file = await new Promise(r => entry.file(r));
      const ext = "." + file.name.split(".").pop().toLowerCase();
      if (_TEXT_EXT_DS.has(ext)) files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise(r => reader.readEntries(r));
      for (const e of entries) files.push(...await _ds_read_entry(e));
    }
    return files;
  }

  async function _ds_add_files(files, source_label) {
    if (!files || files.length === 0) return;
    const msg = document.getElementById("salvage_status_msg");
    const name = source_label || "import_" + new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 15);
    if (msg) msg.textContent = `${files.length} file(s)...`;
    // 全ファイルのテキストを読んでバッチで送る
    const batch = [];
    for (const file of files) {
      try {
        const text = await file.text();
        if (!text.trim()) continue;
        batch.push({ filename: file.name, content: text });
      } catch(e) { console.error("ds read error", e); }
    }
    if (batch.length === 0) { if (msg) msg.textContent = ""; return; }
    try {
      const res = await fetch("/api/salvage/save_batch", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ source_name: name, files: batch }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        if (msg) msg.textContent = `${data.file_count} file(s) added`;
        window._salvage_highlight_source = data.source_name;
        _salvage_load_sources();
      }
    } catch(e) { console.error("ds batch save error", e); if (msg) msg.textContent = "Error"; }
  }

  if (_dz) {
    _dz.addEventListener("dragover", (e) => { e.preventDefault(); _dz.classList.add("dragover"); });
    _dz.addEventListener("dragleave", (e) => { if (e.target === _dz || e.target.parentElement === _dz) _dz.classList.remove("dragover"); });
    _dz.addEventListener("drop", async (e) => {
      e.preventDefault();
      _dz.classList.remove("dragover");
      const items = e.dataTransfer.items;
      let folder_name = "";
      if (items && items.length > 0 && items[0].webkitGetAsEntry) {
        const all_files = [];
        for (const item of items) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            if (entry.isDirectory && !folder_name) folder_name = entry.name;
            all_files.push(...await _ds_read_entry(entry));
          }
        }
        if (all_files.length > 0) {
          await _ds_add_files(all_files, folder_name);
          return;
        }
      }
      await _ds_add_files(e.dataTransfer.files, folder_name);
    });
    _dz.addEventListener("click", () => _fi?.click());
  }
  if (_fi) {
    _fi.addEventListener("change", (e) => {
      _ds_add_files(e.target.files, "");
      _fi.value = "";
    });
  }
}

// データソース画面を開く
document.getElementById("btn_open_salvage")?.addEventListener("click", () => {
  history.pushState({}, "", "/datasource");
  _salvage_show_view();
});

// データソース画面から戻る
document.getElementById("btn_salvage_back")?.addEventListener("click", () => {
  history.pushState({}, "", "/knowledge");
  _salvage_hide_view();
});

// ナレッジ画面表示時にサルベージステータスも確認
const _orig_show_knowledge = show_knowledge_view;
show_knowledge_view = function() {
  _orig_show_knowledge();
  _salvage_check_status();
  _salvage_hide_view(); // サルベージサブビューはリセット
};


// ========== Search View ==========
let _search_offset = 0;
let _search_query = "";
let _search_timer = null;
let _search_mode = "or"; // "or" | "and"

function show_search_view() {
  const sv = document.getElementById("search_view");
  if (!sv) return;
  hide_thread_list_view();
  // ナレッジビューも閉じる
  const kv = document.getElementById("knowledge_view");
  if (kv) kv.style.display = "none";
  _set_topbar_mode("no_chat");
  const cb = document.getElementById("closed_banner");
  if (cb) cb.style.display = "none";
  document.querySelector(".chat_wrap").style.display = "none";
  const composer = document.getElementById("composer_dock");
  if (composer) composer.style.display = "none";
  sv.style.display = "";
  _search_offset = 0;
  _search_query = "";
  document.getElementById("search_body").innerHTML = "";
  document.getElementById("search_status").textContent = "";
  const inp = document.getElementById("search_input");
  if (inp) { inp.value = ""; setTimeout(() => inp.focus(), 100); }
  document.getElementById("btn_search_clear")?.classList.remove("is_visible");
}

function hide_search_view() {
  const sv = document.getElementById("search_view");
  if (!sv) return;
  sv.style.display = "none";
  document.querySelector(".chat_wrap").style.display = "";
  const composer = document.getElementById("composer_dock");
  if (composer) composer.style.display = "";
  const _is_archived = btn_end_chat_thread?.dataset.closed === "true";
  const cb = document.getElementById("closed_banner");
  if (cb) cb.style.display = "";
  // アーカイブ済みスレッドではcomposerを戻さない
  if (_is_archived && composer) composer.style.display = "none";
  // 個別チャットに戻るか新規チャットかで判定
  _set_topbar_mode(document.querySelector(".new_chat_screen") ? "new_chat" : "chat");
}

async function do_search(query, append = false) {
  if (!query.trim()) return;
  _search_query = query.trim();
  if (!append) _search_offset = 0;
  const body = document.getElementById("search_body");
  const status = document.getElementById("search_status");
  if (!append) body.innerHTML = "";
  // "もっと見る" ボタンがあれば削除
  body.querySelector(".search_more_btn")?.remove();

  // 複数キーワード検知 → AND/ORトグル表示
  const keywords = _search_query.split(/\s+/).filter(k => k);
  _update_search_mode_toggle(keywords.length >= 2);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(_search_query)}&limit=50&offset=${_search_offset}&mode=${_search_mode}`);
    const data = await res.json();
    const results = data.results || [];
    const total = data.total || 0;
    const has_more = data.has_more || false;

    const mode_label = keywords.length >= 2 ? ` (${_search_mode.toUpperCase()})` : "";
    status.textContent = t("search_results_count").replace("${count}", total) + mode_label;

    if (results.length === 0 && !append) {
      body.innerHTML = `<div class="search_empty">${t("search_no_results")}</div>`;
      return;
    }

    results.forEach(r => {
      const item = document.createElement("div");
      item.classList.add("search_item");

      // メタ行: スレッドタイトル + role + 日時
      const meta = document.createElement("div");
      meta.classList.add("search_item_meta");
      const thread_label = r.thread_title || r.chat_thread_id.slice(0, 8);
      const mode_icon = r.thread_mode === "multi" ? "👥 " : "";
      meta.innerHTML = `<span class="search_item_thread">${mode_icon}${_esc(thread_label)}</span>`;
      const role_label = r.role === "user" ? t("search_user") : (r.actor_name || "AI");
      meta.innerHTML += `<span class="search_item_role">${_esc(role_label)}</span>`;
      meta.innerHTML += `<span>${format_thread_list_date(r.created_at)}</span>`;
      item.appendChild(meta);

      // プレビュー（検索語ハイライト）
      const preview = document.createElement("div");
      preview.classList.add("search_item_preview");
      let text = r.content_preview || "";
      if (text.length > 200) text = text.slice(0, 200) + "...";
      // ハイライト（複数キーワード色違い）
      const kws = _search_query.split(/\s+/).filter(k => k);
      let hl_html = _esc(text);
      if (kws.length <= 1) {
        const esc_q = _search_query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        hl_html = hl_html.replace(new RegExp(`(${esc_q})`, "gi"), "<mark>$1</mark>");
      } else {
        // 全キーワードを1つの正規表現でマッチし、キーワード番号で色分け
        const esc_kws = kws.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const combined = new RegExp(`(${esc_kws.join("|")})`, "gi");
        const kws_lower = kws.map(k => k.toLowerCase());
        hl_html = hl_html.replace(combined, (m) => {
          const idx = kws_lower.indexOf(m.toLowerCase());
          const cls = idx < 3 ? `hl${idx + 1}` : "hl4";
          return `<mark class="${cls}">${m}</mark>`;
        });
      }
      preview.innerHTML = hl_html;
      item.appendChild(preview);

      // クリック → スレッド開いてスクロール
      item.addEventListener("click", () => {
        hide_search_view();
        _open_thread_and_scroll(r.chat_thread_id, r.leaf_id);
      });

      body.appendChild(item);
    });

    _search_offset += results.length;

    // "もっと見る" ボタン
    if (has_more) {
      const btn = document.createElement("button");
      btn.classList.add("search_more_btn");
      btn.textContent = t("search_more");
      btn.addEventListener("click", () => do_search(_search_query, true));
      body.appendChild(btn);
    }
  } catch (e) {
    console.error("[SEARCH]", e);
    status.textContent = "Error";
  }
}

function _update_search_mode_toggle(show) {
  let toggle = document.getElementById("search_mode_toggle");
  if (!show) {
    if (toggle) toggle.style.display = "none";
    _search_mode = "or";
    return;
  }
  if (!toggle) {
    toggle = document.createElement("div");
    toggle.id = "search_mode_toggle";
    toggle.classList.add("search_mode_toggle");
    // 検索ステータスの前に挿入
    const status = document.getElementById("search_status");
    status.parentNode.insertBefore(toggle, status);
  }
  toggle.style.display = "";
  toggle.innerHTML = `
    <button class="search_mode_btn ${_search_mode === 'or' ? 'is_active' : ''}" data-mode="or">OR</button>
    <button class="search_mode_btn ${_search_mode === 'and' ? 'is_active' : ''}" data-mode="and">AND</button>
    <span class="search_mode_hint">${_search_mode === "or" ? t("search_or_hint") : t("search_and_hint")}</span>
  `;
  toggle.querySelectorAll(".search_mode_btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _search_mode = btn.dataset.mode;
      do_search(_search_query);
    });
  });
}

function _esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function _open_thread_and_scroll(thread_id, leaf_id) {
  // チャット画面を一旦隠して白チラ見え防止
  const chat_wrap = document.querySelector(".chat_wrap");
  if (chat_wrap) chat_wrap.style.opacity = "0";
  await load_chat_thread(thread_id);
  // メッセージが描画されるのを待ってからスクロール
  setTimeout(() => {
    if (chat_wrap) chat_wrap.style.opacity = "1";
    const el = document.querySelector(`[data-msg_id="${leaf_id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // ハイライトアニメーション
      el.style.transition = "outline 0.3s, outline-offset 0.3s";
      el.style.outline = "2px solid var(--accent)";
      el.style.outlineOffset = "4px";
      setTimeout(() => { el.style.outline = "none"; el.style.outlineOffset = "0"; }, 2000);
    }
  }, 400);
}

// イベントバインド
document.getElementById("btn_search_back")?.addEventListener("click", hide_search_view);
document.getElementById("btn_search_submit")?.addEventListener("click", () => {
  const q = document.getElementById("search_input")?.value;
  if (q && q.trim()) do_search(q);
});
document.getElementById("search_input")?.addEventListener("input", (e) => {
  clearTimeout(_search_timer);
  // × クリアボタン表示制御
  const cb = document.getElementById("btn_search_clear");
  if (cb) cb.classList.toggle("is_visible", e.target.value.length > 0);
  _search_timer = setTimeout(() => {
    const q = e.target.value;
    if (q.trim().length >= 2) do_search(q);
    else {
      document.getElementById("search_body").innerHTML = "";
      document.getElementById("search_status").textContent = "";
    }
  }, 400);
});
// × クリアボタン
document.getElementById("btn_search_clear")?.addEventListener("click", () => {
  const inp = document.getElementById("search_input");
  if (inp) { inp.value = ""; inp.focus(); }
  document.getElementById("btn_search_clear")?.classList.remove("is_visible");
  document.getElementById("search_body").innerHTML = "";
  document.getElementById("search_status").textContent = "";
  _update_search_mode_toggle(false);
});
document.getElementById("search_input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(_search_timer);
    const q = e.target.value;
    if (q.trim()) do_search(q);
  }
});

function format_thread_list_date(date_str) {
  if (!date_str) return "";
  const d = new Date(date_str + "Z");
  const now = new Date();
  const diff = now - d;
  const day_ms = 86400000;
  const _locale = get_lang() === "en" ? "en-US" : "ja-JP";
  if (diff < day_ms) {
    return d.toLocaleTimeString(_locale, { hour: "2-digit", minute: "2-digit" });
  } else if (diff < day_ms * 7) {
    const days = Math.floor(diff / day_ms);
    const time = d.toLocaleTimeString(_locale, { hour: "2-digit", minute: "2-digit" });
    return get_lang() === "en" ? `${days}d ago ${time}` : `${days}日前 ${time}`;
  } else {
    return d.toLocaleDateString(_locale, { year: "numeric", month: "short", day: "numeric" });
  }
}

// イベント接続
document.getElementById("btn_thread_list_back")?.addEventListener("click", () => {
  history.back();
});
document.getElementById("btn_sidebar_more")?.addEventListener("click", () => {
  window.location.href = "/threads";
});

function confirm_delete_chat(thread_id, label) {
  const trash_days = window._trash_retention_days || 15;
  open_modal(t("trash_delete_title"), `
    <div style="margin-bottom:16px;">${t("trash_move_confirm").replace("{name}", label).replace("{days}", trash_days)}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="modal_btn_cancel" id="del_cancel_btn">${t("cancel")}</button>
      <button class="modal_btn_danger" id="del_confirm_btn">${t("trash_delete_btn")}</button>
    </div>
  `);
  document.getElementById("del_cancel_btn")?.addEventListener("click", close_modal);
  document.getElementById("del_confirm_btn")?.addEventListener("click", async () => {
    close_modal();
    const res = await fetch(`/api/chat_thread/${thread_id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.status === "ok") {
      if (chat_thread_id === thread_id) {
        // 現在表示中のスレッドが削除された
        chat_thread_id = "";
        chat_el.innerHTML = "";
        update_url("");
        set_composer_disabled(true);
        add_system_message(
          `${t("trash_moved")}<br><a href="#" onclick="show_trash_modal();return false;" style="color:var(--accent);">${t("trash_open")}</a>`,
          {raw_html: true}
        );
      }
      await load_sidebar_chats();
    }
  });
}

function start_title_edit(item, sid, title_el) {
  const current = title_el.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.classList.add("sidebar_title_input");
  input.maxLength = 100;

  title_el.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const new_title = input.value.trim();
    if (new_title && new_title !== current) {
      await fetch(`/api/chat_thread/${sid}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: new_title }),
      });
    }
    const span = document.createElement("span");
    span.classList.add("sidebar_chat_title");
    span.textContent = new_title || current;
    input.replaceWith(span);

    // edit_btnの参照を再接続
    const edit_btn = item.querySelector(".sidebar_edit_btn");
    if (edit_btn) {
      edit_btn.onclick = (e) => {
        e.stopPropagation();
        start_title_edit(item, sid, span);
      };
    }
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = current; input.blur(); }
  });
  input.addEventListener("click", (e) => e.stopPropagation());
}

function format_sidebar_date(date_str) {
  if (!date_str) return "";
  const d = new Date(date_str + "Z");
  const now = new Date();
  const diff = now - d;
  const day_ms = 86400000;

  const _locale = get_lang() === "en" ? "en-US" : "ja-JP";
  if (diff < day_ms) {
    return d.toLocaleTimeString(_locale, { hour: "2-digit", minute: "2-digit" });
  } else if (diff < day_ms * 7) {
    const days = Math.floor(diff / day_ms);
    return get_lang() === "en" ? `${days}d ago` : `${days}日前`;
  } else {
    return d.toLocaleDateString(_locale, { month: "short", day: "numeric" });
  }
}

function reset_thread_ui() {
  // 新規チャット画面が残ってたら消す（テーマ反映の前提）
  document.querySelector(".new_chat_screen")?.remove();
  document.getElementById("closed_banner")?.remove();
  document.getElementById("reopen_menu")?.remove();
  document.querySelector(".free_mode_panel")?.remove();
  document.querySelector(".nomination_panel")?.remove();
  // モーダルが残っていたら閉じる（common_modalは除外）
  try { close_modal(); } catch (e) { /* modal not ready */ }
  document.querySelectorAll(".modal_overlay:not(#common_modal):not(#token_stats_modal):not(#trash_modal):not(#user_settings_modal):not(#ov_info_modal):not(#apikey_modal):not(#init_modal), .fullscreen_modal").forEach(el => el.remove());
  set_composer_disabled(false);
  const btn = btn_end_chat_thread;
  btn.dataset.closed = "";
  btn.onclick = null;
  btn.style = "";
  btn.innerHTML = `<svg viewBox="0 0 24 24" class="svg_icon" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" stroke-width="1.8" stroke-linecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  btn.title = "End Session";
}

async function load_chat_thread(target_chat_thread_id) {
  try {
    // スレッド一覧が表示中なら閉じる
    hide_thread_list_view();
    _set_topbar_mode("chat");
    // スレッド切替時: UI完全リセット
    reset_thread_ui();
    _dismiss_mascot();  // 新規画面のマスコットを消す
    // アーカイブ吹き出しを削除（前のスレッドの残り）
    document.querySelector(".ob_archive_bubble")?.remove();

    // セッション切替をサーバーに通知（actor_idも自動復元）
    const switch_res = await fetch(`/api/chat_thread/switch/${target_chat_thread_id}`, { method: "POST" });
    const switch_data = await switch_res.json();
    chat_thread_id = target_chat_thread_id;
    update_url(chat_thread_id);
    _shown_experience_abstracts.clear();  // スレッド切替時に経験通知の重複チェックをリセット

    // サイドバーのactive状態を更新
    load_sidebar_chats();

    // actor名をタイトルに反映
    if (switch_data.actor_info) {
      _set_title_pill(switch_data.actor_info);
    }
    // 記憶パネル更新（actor切替を反映）
    update_memory_layer_panel();
    // エンジンバッジ・テーマ更新（actor切替後のengineを反映）
    await update_engine_badge();
    // セッション没入度をリセットしてからバッジ更新
    current_chat_thread_immersion = null;
    // セッション没入度の上書きを確認
    const imm_res = await fetch(`/api/setting/chat_thread_immersion:${target_chat_thread_id}`);
    const imm_data = await imm_res.json();
    const thread_imm = imm_data.value ? parseFloat(imm_data.value) : null;
    update_immersion_badge(switch_data.actor_info, thread_imm);
    update_ov_badge(switch_data.ov_info);
    // UMAバッジ更新（温度 + 距離感）— 会議モードはstate APIから平均温度を取得
    if (switch_data.mode === "multi") {
      const st_res = await fetch(`/api/chat_thread/${target_chat_thread_id}/state`);
      const st_data = await st_res.json();
      update_uma_badge(st_data.uma_temperature != null ? st_data.uma_temperature : 3);
      update_distance_badge(st_data.uma_distance != null ? st_data.uma_distance : 0.5);
    } else {
      const uma_res = await fetch(`/api/setting/uma_temperature:${target_chat_thread_id}`);
      const uma_data = await uma_res.json();
      update_uma_badge(uma_data.value ? parseFloat(uma_data.value) : 2.0);
      const dist_res = await fetch(`/api/setting/uma_distance:${target_chat_thread_id}`);
      const dist_data = await dist_res.json();
      update_distance_badge(dist_data.value ? parseFloat(dist_data.value) : 0.7);
    }

    // チャット欄をクリア
    chat_el.innerHTML = "";

    // スレッド状態確認（削除・完全削除判定）
    const status_res = await fetch(`/api/chat_thread/${target_chat_thread_id}/status`);
    const status_data = await status_res.json();
    if (status_data.status === "purged") {
      add_system_message(t("trash_chat_deleted"));
      set_composer_disabled(true);
      return;
    }
    if (status_data.status === "deleted") {
      add_system_message(`${t("trash_chat_in_trash")}<br><a href="#" onclick="show_trash_modal();return false;" style="color:var(--accent);">${t("trash_open")}</a>`, {raw_html: true});
      set_composer_disabled(true);
      return;
    }

    // 会議モード判定
    try {
      const mp_res = await fetch(`/api/multi/participants?chat_thread_id=${target_chat_thread_id}`);
      const mp_data = await mp_res.json();
      if (mp_data.mode === "multi" && mp_data.participants?.length > 0) {
        is_multi_mode = true;
        multi_participants = mp_data.participants;
        multi_conv_mode = mp_data.conversation_mode || "sequential";
        title_pill.textContent = _multi_title(multi_participants);
        _show_multi_participants_bar(multi_participants, multi_conv_mode);
        _apply_multi_mode_ui(multi_participants);
        input_el.placeholder = t("meeting_composer_ph");
      } else {
        is_multi_mode = false;
        multi_participants = [];
        _clear_multi_mode_ui();
      }
    } catch (e) {
      is_multi_mode = false;
      multi_participants = [];
    }

    // メッセージを読み込み
    const res = await fetch(`/api/chat_thread/${target_chat_thread_id}/leaf`);
    const data = await res.json();
    const message_list = data.message || [];

    const visible_messages = message_list.filter(m => !m.is_system_context || m.role === "system_event");

    if (visible_messages.length === 0) {
      show_welcome_message();
      return;
    }

    // 会議モード用: actor_id → 色マッピング
    const _multi_color_map = {};
    if (is_multi_mode) {
      multi_participants.forEach(p => {
        _multi_color_map[p.actor_id] = { name: p.actor_name, color: p.color, label: p.label };
      });
    }

    visible_messages.forEach(m => {
      if (m.role === "system_event") {
        // セレベメッセージは専用表示
        if (is_multi_mode && m.content && m.content.startsWith("🧠")) {
          add_cerebellum_message(m.content);
        } else if (is_multi_mode && m.content && m.content.startsWith("🏷️")) {
          add_cerebellum_message(m.content);
        } else {
          add_system_message(m.content);
        }
        return;
      }
      // 会議モード: assistant メッセージを色分け表示
      if (is_multi_mode && m.role === "assistant" && m.actor_id && _multi_color_map[m.actor_id]) {
        const info = _multi_color_map[m.actor_id];
        add_multi_message(info.name, m.content, info.color, m.model, !!m.is_blind, m.actor_id, m.id, info.label);
        return;
      }
      const msg_el = add_message(m.role, m.content, m.id || null, m.attachment || "");
      if (m.role === "assistant" && m.model) {
        const _ms = _shorten_model(m.model);
        const _lbl = document.createElement("div");
        _lbl.className = "msg_model_label";
        _lbl.textContent = _ms;
        msg_el.appendChild(_lbl);
      }
    });

    scroll_to_bottom();

    // 未解決の承認待ちがあればモーダル表示
    try {
      const ap_res = await fetch("/api/approvals/pending");
      const ap_list = await ap_res.json();
      ap_list.filter(p => p.chat_thread_id === chat_thread_id).forEach(p => show_trait_approval(p));
    } catch (e) { /* ignore */ }

    // スレッドが固定化されていれば再開UIを表示
    await check_thread_state(target_chat_thread_id);

    // オンボーディング: アーカイブ未経験 & 10ラリー超 → 吹き出し
    if (!localStorage.getItem("ob_archive_done")) {
      const _msg_count = chat_el.querySelectorAll(".msg_user").length;
      if (_msg_count >= 10) {
        document.querySelector(".ob_archive_bubble")?.remove();
        const bubble = document.createElement("div");
        bubble.className = "ob_archive_bubble";
        bubble.textContent = t("ob_try_archive") || "アーカイブして、人格・アクターを賢くしよう";
        const close_btn = document.getElementById("btn_end_session");
        if (close_btn) {
          close_btn.style.position = "relative";
          close_btn.appendChild(bubble);
        }
      }
    }
  } catch (e) {
    console.error("Chat thread load error:", e);
    add_system_message(t("chat_load_error"));
  }
}

// 新規チャットボタン
document.getElementById("btn_new_chat")?.addEventListener("click", () => {
  if (is_threads_url()) {
    window.location.href = "/";
    return;
  }
  toggle_sidebar();
  hide_knowledge_view();
  hide_search_view();
  window.history.pushState({}, "", "/");
  show_new_chat_screen();
});

// ユーザー情報ボタン
document.getElementById("btn_user_profile")?.addEventListener("click", () => {
  toggle_sidebar();
  add_system_message(t("user_profile_wip"));
});

// 設定ボタン → ユーザー設定モーダルを開く
document.getElementById("btn_settings")?.addEventListener("click", () => {
  show_user_settings_modal();
});

// ========== User Settings Modal ==========
const user_settings_modal = document.getElementById("user_settings_modal");

let _apikey_status_cache = {};
async function show_user_settings_modal() {
  if (!user_settings_modal) return;
  user_settings_modal.style.display = "flex";
  _sync_transparency_toggle();
  _sync_imitation_dev_toggle();
  const _apikey_st = document.getElementById("us_apikey_status");
  if (_apikey_st) _apikey_st.textContent = "";
  // APIキーステータスを取得してUI反映
  try {
    const res = await fetch("/api/api_key_status");
    if (res.ok) {
      _apikey_status_cache = await res.json();
      const sel = document.getElementById("us_apikey_engine");
      if (sel && _apikey_status_cache.default_engine) {
        sel.value = _apikey_status_cache.default_engine;
      }
      _sync_apikey_placeholder();
    }
  } catch (e) {}
}

function _sync_apikey_placeholder() {
  const sel = document.getElementById("us_apikey_engine");
  const inp = document.getElementById("us_apikey_input");
  const status_el = document.getElementById("us_apikey_status");
  if (!sel || !inp) return;
  const eng = sel.value;
  const masked = _apikey_status_cache[eng] || "";
  inp._masked_value = masked;  // 部分マスク（sk-proj-••••••RacA）
  inp._hidden_value = masked ? "••••••••••••••••" : "";  // 全隠し
  inp._is_revealed = false;
  const toggle_btn = document.getElementById("btn_us_apikey_toggle");
  if (masked) {
    inp.value = inp._hidden_value;
    inp.type = "text";  // ••を見せるためtext
    inp.style.color = "#888";
    inp.placeholder = "";
    if (toggle_btn) { toggle_btn.textContent = "👁"; toggle_btn.style.display = ""; }
    if (status_el) {
      status_el.textContent = "✅ " + t("us_key_set");
      status_el.style.color = "#4caf50";
    }
  } else {
    inp.value = "";
    inp.type = "password";
    inp.style.color = "#e0e0e0";
    const _placeholders = { claude: "sk-ant-...", openai: "sk-proj-...", gemini: "AIza..." };
    inp.placeholder = _placeholders[eng] || "API Key";
    if (toggle_btn) toggle_btn.style.display = "none";
    if (status_el) {
      status_el.textContent = "";
    }
  }
}

// フォーカス時: マスク表示をクリアして入力可能に
document.getElementById("us_apikey_input")?.addEventListener("focus", function() {
  if (this.value === this._hidden_value || this.value === this._masked_value) {
    this.value = "";
    this.style.color = "#e0e0e0";
    this.type = "password";
  }
});
// blur時: 未入力ならマスク表示を戻す
document.getElementById("us_apikey_input")?.addEventListener("blur", function() {
  if (!this.value.trim() && this._hidden_value) {
    this.value = this._is_revealed ? this._masked_value : this._hidden_value;
    this.type = "text";
    this.style.color = "#888";
  }
});

// 👁ボタン: 設定済み時は ••••↔マスク値 切替、新規入力時は password↔text 切替
function _toggle_apikey_visibility() {
  const inp = document.getElementById("us_apikey_input");
  const btn = document.getElementById("btn_us_apikey_toggle");
  if (!inp || !btn) return;
  // 設定済みマスク表示中（ユーザーがまだ入力していない）
  if (inp._masked_value && (inp.value === inp._hidden_value || inp.value === inp._masked_value)) {
    inp._is_revealed = !inp._is_revealed;
    inp.value = inp._is_revealed ? inp._masked_value : inp._hidden_value;
    btn.textContent = inp._is_revealed ? "🙈" : "👁";
  } else {
    // 新規入力中: password ↔ text 切替
    if (inp.type === "password") {
      inp.type = "text";
      btn.textContent = "🙈";
    } else {
      inp.type = "password";
      btn.textContent = "👁";
    }
  }
}

function hide_user_settings_modal() {
  user_settings_modal.style.display = "none";
}

document.getElementById("btn_user_settings_close")?.addEventListener("click", hide_user_settings_modal);

// 半透明モード トグルスイッチ
function _sync_transparency_toggle() {
  const cb = document.getElementById("toggle_transparency");
  const track = document.getElementById("toggle_transparency_track");
  const thumb = document.getElementById("toggle_transparency_thumb");
  if (!cb) return;
  const is_on = transparency_mode === "on";
  cb.checked = is_on;
  if (track) track.style.background = is_on ? "#f0a500" : "#222";
  if (thumb) {
    thumb.style.left = is_on ? "24px" : "4px";
    thumb.style.background = is_on ? "#fff" : "#555";
  }
}

document.getElementById("toggle_transparency")?.addEventListener("change", (e) => {
  const next = e.target.checked ? "on" : "off";
  save_transparency_mode(next);
  _sync_transparency_toggle();
});

// ========== Imitation Dev Mode ==========
async function load_imitation_dev_mode() {
  try {
    const res = await fetch("/api/setting/imitation_dev_mode");
    if (res.ok) {
      const data = await res.json();
      imitation_dev_mode = data.value === "on";
    }
  } catch (e) {}
  _sync_imitation_dev_toggle();
}

async function save_imitation_dev_mode(mode) {
  imitation_dev_mode = mode === "on";
  try {
    await fetch("/api/setting/imitation_dev_mode", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: mode }),
    });
  } catch (e) {}
}

function _sync_imitation_dev_toggle() {
  const cb = document.getElementById("toggle_imitation_dev");
  const track = document.getElementById("toggle_imitation_dev_track");
  const thumb = document.getElementById("toggle_imitation_dev_thumb");
  if (!cb) return;
  cb.checked = imitation_dev_mode;
  if (track) track.style.background = imitation_dev_mode ? "#f0a500" : "#222";
  if (thumb) {
    thumb.style.left = imitation_dev_mode ? "24px" : "4px";
    thumb.style.background = imitation_dev_mode ? "#fff" : "#555";
  }
}

document.getElementById("toggle_imitation_dev")?.addEventListener("change", (e) => {
  save_imitation_dev_mode(e.target.checked ? "on" : "off");
  _sync_imitation_dev_toggle();
});

// ========== 通貨設定 ==========
const _CURRENCY_SYMBOLS = { JPY: "¥", USD: "$", EUR: "€", GBP: "£", KRW: "₩", CNY: "¥", TWD: "NT$" };
const _CURRENCY_DEFAULTS = { JPY: 150, USD: 1, EUR: 0.92, GBP: 0.79, KRW: 1380, CNY: 7.3, TWD: 32 };
let _user_currency = "JPY";
let _user_currency_rate = 150;

async function _load_currency_settings() {
  try {
    const [cRes, rRes] = await Promise.all([
      fetch("/api/setting/user_currency"),
      fetch("/api/setting/usd_to_jpy"),
    ]);
    const cData = await cRes.json();
    const rData = await rRes.json();
    _user_currency = cData.value || "JPY";
    _user_currency_rate = parseFloat(rData.value) || _CURRENCY_DEFAULTS[_user_currency] || 150;
  } catch (e) {}
  _sync_currency_ui();
}

function _sync_currency_ui() {
  const sel = document.getElementById("us_currency_select");
  const inp = document.getElementById("us_currency_rate");
  if (sel) sel.value = _user_currency;
  if (inp) inp.value = _user_currency_rate;
}

function _format_local_cost(cost_usd) {
  const local = cost_usd * _user_currency_rate;
  const sym = _CURRENCY_SYMBOLS[_user_currency] || _user_currency;
  if (_user_currency === "USD" || _user_currency === "EUR" || _user_currency === "GBP") {
    return `${sym}${local.toFixed(4)}`;
  }
  return `${sym}${Math.round(local).toLocaleString()}`;
}

document.getElementById("us_currency_select")?.addEventListener("change", async (e) => {
  _user_currency = e.target.value;
  _user_currency_rate = _CURRENCY_DEFAULTS[_user_currency] || 150;
  document.getElementById("us_currency_rate").value = _user_currency_rate;
  await Promise.all([
    fetch("/api/setting/user_currency", { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({value: _user_currency}) }),
    fetch("/api/setting/usd_to_jpy", { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({value: String(_user_currency_rate)}) }),
  ]);
});

document.getElementById("us_currency_rate")?.addEventListener("change", async (e) => {
  _user_currency_rate = parseFloat(e.target.value) || 150;
  await fetch("/api/setting/usd_to_jpy", { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({value: String(_user_currency_rate)}) });
});

_load_currency_settings();

// APIキー保存（ユーザー設定モーダル内）
document.getElementById("btn_us_apikey_submit")?.addEventListener("click", async () => {
  const inp = document.getElementById("us_apikey_input");
  const api_key = inp.value.trim();
  const engine_type = document.getElementById("us_apikey_engine").value;
  const status_el = document.getElementById("us_apikey_status");
  // マスク値のままsubmitしない
  if (!api_key || api_key === inp._masked_value) {
    status_el.textContent = t("ak_enter_key");
    status_el.style.color = "#e74c3c";
    return;
  }
  try {
    const res = await fetch("/api/set_api_key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key, engine: engine_type }),
    });
    const data = await res.json();
    if (res.ok) {
      status_el.textContent = `✓ ${t("ak_saved").replace("{name}", data.engine_name)}`;
      status_el.style.color = "#2ecc71";
      document.getElementById("us_apikey_input").value = "";
      // エンジンバッジ更新
      const theme = engine_themes[data.engine] || engine_themes.claude;
      document.body.className = "";
      document.body.classList.add(theme.class);
      engine_badge.textContent = data.engine_name;
    } else {
      status_el.textContent = t(data.error) || data.error || t("ak_save_fail");
      status_el.style.color = "#e74c3c";
    }
  } catch (e) {
    status_el.textContent = t("net_error");
    status_el.style.color = "#e74c3c";
  }
});

// APIキーリセット（ユーザー設定モーダル内）
document.getElementById("btn_us_apikey_reset")?.addEventListener("click", async () => {
  const engine_type = document.getElementById("us_apikey_engine").value;
  const status_el = document.getElementById("us_apikey_status");
  if (!await show_confirm(t("ak_reset_confirm").replace("{engine}", engine_type))) return;
  try {
    const res = await fetch(`/api/set_api_key/${engine_type}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      status_el.textContent = t("ak_reset_done");
      status_el.style.color = "#aaa";
    } else {
      status_el.textContent = data.error || t("ak_reset_fail");
      status_el.style.color = "#e74c3c";
    }
  } catch (e) {
    status_el.textContent = t("net_error");
    status_el.style.color = "#e74c3c";
  }
});

// APIキーモーダルの閉じるボタン（engine_readyの場合のみ閉じれる）
document.getElementById("btn_apikey_close")?.addEventListener("click", hide_apikey_modal);

// APIキーモーダル「戻る」→ 言語選択に戻る（言語をリセットして再選択）
document.getElementById("btn_apikey_back")?.addEventListener("click", () => {
  localStorage.removeItem("epl_lang");
  hide_apikey_modal();
  const lang = document.getElementById("lang_modal");
  if (lang) lang.style.display = "flex";
});

// API Key 表示/非表示トグル
document.getElementById("btn_apikey_toggle_vis")?.addEventListener("click", () => {
  const inp = document.getElementById("apikey_input");
  const btn = document.getElementById("btn_apikey_toggle_vis");
  if (inp.type === "password") {
    inp.type = "text";
    btn.textContent = "🔒";
  } else {
    inp.type = "password";
    btn.textContent = "👁";
  }
});

// ========== コーヒーブレイク表示 ==========
function _show_nudge(nudge) {
  // コーヒーブレイク
  if (nudge.coffee) {
    const coffee_key = "coffee_" + nudge.coffee;
    add_cerebellum_message(t(coffee_key));
  }
}

// ========== New Chat Screen ==========
let selected_actor_id = null;

// ========== ドット絵マスコット（アニメーション対応） ==========
// 各キャラ: 14x14グリッド, フレームアニメーション, box-shadowで描画
// 色: _ = 透明, h = 髪, s = 肌, e = 目, w = 服, m = 口, b = アクセント, p = 靴/脚, r = 装飾, k = 小物
const _MASCOT_CHARS = {
  // ── アド子 研究服（2フレームアニメ + アイテム）──
  normal: {
    title: "Lab Coat Anim",
    fps: 1.25,
    colors: {
      d:"#384868",
      h:"#B0C0D0", g:"#7890A8",
      v:"#FFE0C1", u:"#F0C898",
      L:"#2A2030", e:"#2060B0", E:"#60A8E8",
      s:"#FFFFFF", n:"#E8E8F0",
      M:"#FFD0B8",
      w:"#E8E8F0", O:"#FFFFFF", q:"#CACADC", Q:"#94ADCC",
      k:"#FFE0C1",
      p:"#805040",
      I:"#DEDDB9", J:"#757437", B:"#165B9A", C:"#60A8E8"
    },
    glow_colors: {
      e:"#17BAC7", E:"#5CE2EC"
    },
    items: {
      flask: {
        grid: [
          "__I__",
          "_JIJ_",
          "JIIIJ",
          "BCCCB"
        ],
        w: 5, h: 4
      },
      tube: {
        grid: [
          "I",
          "I",
          "C"
        ],
        w: 1, h: 3
      }
    },
    frames: [
      [
        "__________________",
        "__________g_______",
        "______dddgdd______",
        "_____dghhhhgd_____",
        "____dghhhhhgd_____",
        "___dghOhhhhhgd____",
        "__dghOhhhghhgd____",
        "__dghhhhguhhhgdg__",
        "__dhhhhguuhhhgg___",
        "__dhhLLvLLuhhhd___",
        "__ghhnevveLhhvd___",
        "_gdhhsEvvEshvhd___",
        "__dhhMvvvMMvhgd___",
        "__dghdvvvvdhgd____",
        "___dgdddddwgd_____",
        "____dwdwuwqqqd____",
        "____kuqOvqkuqd____",
        "____kuuwOwkud_____",
        "_____uqQwqwq______",
        "______qqQwqwq_____",
        "______qQQQwqww____",
        "_______QgQQw______",
        "______dQgQQQd_____",
        "______dppdppd_____",
      ],
      [
        "__________________",
        "________g_________",
        "______dddgdd______",
        "_____dghhhhgd_____",
        "____dghOhhhgd_____",
        "___dghOhhhhhgd____",
        "__dghhhhhghhgd____",
        "__dghhhhguhhhgd___",
        "__dhhhhguuhhhgg___",
        "_gdhhLLvLLuhhhdg__",
        "__ghhnevveLhhvd___",
        "__dhhsEvvEshvhd___",
        "__dhhMvvvMMvhgd___",
        "__dghdvvvvdhgd____",
        "___dgdddddwgd_____",
        "____dwdwuwqwqd____",
        "_____OqOvOwqwd____",
        "____kuqwOwkud_____",
        "____kuuQwqku______",
        "_____uqqQwqwq_____",
        "______qQQQwqww____",
        "_______QgQQw______",
        "______dQgQQQd_____",
        "______dppdppd_____",
      ],
    ]
  },
};

let _mascot_timer = null;

function _grid_to_shadow(grid, colors, px_w, px_h) {
  if (px_h === undefined) px_h = px_w; // 後方互換
  const shadows = [];
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === "_") continue;
      const color = colors[c];
      if (!color) continue;
      shadows.push(`${x * px_w}px ${y * px_h}px 0 0 ${color}`);
    }
  }
  return shadows.join(",");
}

let _mascot_pos_observer = null;

function _update_mascot_pos() {
  const wrap = document.getElementById("pixel_mascot_wrap");
  const dock = document.getElementById("composer_dock");
  if (!wrap || !dock) return;
  // dockの見た目の上端からマスコットを配置
  // box-shadowは wrap(4x4)から下方向に伸びるので、マスコット高さ分上に持ち上げる
  const rect = dock.getBoundingClientRect();
  const dock_top_from_bottom = window.innerHeight - rect.top;
  const mascot_h = 24 * 4; // 24rows × 4px
  const overlap = 4; // 1ドット重なり
  wrap.style.bottom = (dock_top_from_bottom + mascot_h - overlap - 4 - 40) + "px";
}

function _spawn_mascot() {
  _dismiss_mascot(); // 既存を消す
  const dock = document.getElementById("composer_dock");
  if (!dock) return;
  const wrap = document.createElement("div");
  wrap.classList.add("pixel_mascot_wrap");
  wrap.id = "pixel_mascot_wrap";
  const mascotResult = _create_pixel_mascot();
  wrap.appendChild(mascotResult);
  // ツールチップ用ヒットエリア（マスコット視覚領域をカバー）
  const hint = document.createElement("div");
  hint.className = "mascot_hint";
  hint.title = (get_lang() === "en") ? "PR Rep. Researcher Adoko" : "広報担当 アド子研究員";
  wrap.appendChild(hint);
  // サンドイッチイースターエッグ（5%の確率、?sandwich=1 で常時表示）
  const _force_sandwich = new URLSearchParams(location.search).has("sandwich");
  const _is_sandwich = _force_sandwich || Math.random() < 0.05;
  // 浮遊アイテム追加（サンドイッチ時はフラスコ・試験管を非表示）
  const charKey = Object.keys(_MASCOT_CHARS)[Math.floor(Math.random() * Object.keys(_MASCOT_CHARS).length)];
  const charData = _MASCOT_CHARS[charKey];
  if (charData && charData.items && !_is_sandwich) {
    const ipw = 4, iph = 4; // アイテムも正方
    if (charData.items.flask) {
      const flask = document.createElement("div");
      flask.className = "mascot_item float_right";
      flask.style.width = ipw + "px";
      flask.style.height = iph + "px";
      flask.style.left = (15 * ipw) + "px";
      flask.style.top = (16 * iph) + "px";
      flask.style.boxShadow = _grid_to_shadow(charData.items.flask.grid, charData.colors, ipw, iph);
      wrap.appendChild(flask);
    }
    if (charData.items.tube) {
      const tube = document.createElement("div");
      tube.className = "mascot_item float_left";
      tube.style.width = ipw + "px";
      tube.style.height = iph + "px";
      tube.style.left = (1 * ipw) + "px";
      tube.style.top = (17 * iph) + "px";
      tube.style.boxShadow = _grid_to_shadow(charData.items.tube.grid, charData.colors, ipw, iph);
      wrap.appendChild(tube);
    }
  }
  if (_is_sandwich) {
    const _sw_colors = {
      a:"#D2AA6E",b:"#A88858",c:"#7E6642",d:"#C0C4B8",e:"#90938A",f:"#F0F5E6",
      g:"#8CBE5A",i:"#709848",j:"#547236",k:"#FFD23C",l:"#CCA830",m:"#FFC828",
      n:"#B86038",o:"#8A482A",p:"#E67846",q:"#997E24",r:"#DC96A0",s:"#B07880",
      t:"#845A60",u:"#FF0000",v:"#990000",w:"#CC0000",x:"#1E2864",y:"#283278",
    };
    const _sw_grid = [
      "_____aaaaaaaaaaaaaaaaaaaaaaa____",
      "___aababababababababababababaa__",
      "___abcbcbcbcccbcbcbcccbcbcbcba__",
      "___bcdedededededededededededcb__",
      "___cdfdfdfdfdfdfdfdfdfdfdfdfdc__",
      "___dfgggggggggggggggggggggggfd__",
      "__ffggigggigigggigggigggggiggff_",
      "_f_gjijijijijijijijijijijijijg_f",
      "___iklkkkkkkkkklkkkklkklkkklkim_",
      "__mkkkkklklklklkkkkkkkkkkkkklkm_",
      "_mlklklkklklklklklklklkkklkkkklm",
      "_lmlklklnnoklnoklklklklklnklklml",
      "_mnpklklppnlqpplklklppnlkplknkl_",
      "_lpnlllqnppqlnplqmlknppklpklplq_",
      "_qqnolqnonolnonollqnonononlonql_",
      "__lrrqrrrrrrrrrrqqlrrrrrrrqrrlq_",
      "__qrslrsrsrsrsrsqlqrsrsrsrlsrql_",
      "__qstqstststststqqqstststsqtsrsl",
      "___uvqwwwvwvwvwwwqquvwvwuwqwuwq_",
      "___uuwuuuuuuuuuuuquuuuuuuuwuuu__",
      "___uvwvwwvwvwvwvwvwvwvwvwvwvwu__",
      "__xyyyyyyyyyyyyyyyyyyyyyyyyyyyx_",
      "_xxyyyyyyyyyyyyyyyyyyyyyyyyyyyxx",
      "__xyyyyyyyyyyyyyyyyyyyyyyyyyyyx_",
      "__xyaaxaaaaaaaxxaaaaaaaaxaaaayx_",
      "__xbbaxbabababxxababababxbabbbx_",
      "___cbbxbbbbbbbxxbbbbbbbbbbbbcc__",
      "_____cbcbcbcbcxxbcbcbcbcbcbc____",
    ];
    const sw = document.createElement("div");
    sw.className = "mascot_item mascot_sandwich";
    const _sw_px = 4;  // 1ドット = 4px（アド子と同じスケール）
    sw.style.cssText = "position:absolute;width:" + _sw_px + "px;height:" + _sw_px + "px;left:" + (-32 * _sw_px + 2 * 4) + "px;top:" + (-31) + "px;";
    sw.style.boxShadow = _grid_to_shadow(_sw_grid, _sw_colors, _sw_px, _sw_px);
    wrap.appendChild(sw);
    // ツールチップ用ヒットエリア（box-shadow本体は小さいのでカバー用divを被せる）
    const sw_hint = document.createElement("div");
    sw_hint.className = "sandwich_hint";
    sw_hint.title = (get_lang() === "en") ? "9-Layer Personality Sandwich" : "9層の人格サンドイッチ";
    sw_hint.style.cssText = "position:absolute;width:" + (32 * _sw_px) + "px;height:" + (28 * _sw_px) + "px;left:" + (-32 * _sw_px + 2 * 4) + "px;top:" + (-31) + "px;pointer-events:auto;cursor:default;";
    wrap.appendChild(sw_hint);
  }
  document.body.appendChild(wrap);
  // 横位置: composer_dock の範囲内でランダム
  const mascot_w = 72; // ドット絵の概算幅 (18px * 4)
  const rect = dock.getBoundingClientRect();
  const margin = 20;
  const min_x = rect.left + margin;
  const max_x = rect.right - margin - mascot_w;
  const rand_x = min_x + Math.random() * Math.max(0, max_x - min_x);
  wrap.style.left = rand_x + "px";
  // 縦位置
  _update_mascot_pos();
  // composer_dockのリサイズ（マジックワード開閉）を監視
  if (_mascot_pos_observer) _mascot_pos_observer.disconnect();
  _mascot_pos_observer = new ResizeObserver(() => _update_mascot_pos());
  _mascot_pos_observer.observe(dock);
  // 歩行タイマー開始
  _mascot_schedule_walk();
}

let _mascot_walk_timer = null;

function _mascot_schedule_walk() {
  if (_mascot_walk_timer) clearTimeout(_mascot_walk_timer);
  const delay = 10000 + Math.random() * 15000; // 10-25秒後に歩き出す
  _mascot_walk_timer = setTimeout(() => _mascot_do_walk(), delay);
}

function _mascot_do_walk() {
  const wrap = document.getElementById("pixel_mascot_wrap");
  const dock = document.getElementById("composer_dock");
  if (!wrap || !dock || wrap.classList.contains("bye")) return;

  const el = wrap.querySelector(".mascot_container");
  if (!el) return;

  // 歩行開始
  wrap.classList.add("walking");

  // 方向をランダムに決定
  const currentX = parseFloat(wrap.style.left) || 0;
  const rect = dock.getBoundingClientRect();
  const mascot_w = 72;
  const margin = 20;
  const min_x = rect.left + margin;
  const max_x = rect.right - margin - mascot_w;

  // 端に近いときは反対方向に歩く
  const range = max_x - min_x;
  const posRatio = range > 0 ? (currentX - min_x) / range : 0.5;
  // 左端寄り(0に近い)→右に歩く、右端寄り(1に近い)→左に歩く、中央はランダム
  let goLeft;
  if (posRatio < 0.2) goLeft = false;
  else if (posRatio > 0.8) goLeft = true;
  else goLeft = Math.random() > 0.5;

  const dist = 40 + Math.random() * 60;
  let targetX = goLeft ? currentX - dist : currentX + dist;
  targetX = Math.max(min_x, Math.min(max_x, targetX));

  // 移動距離が小さすぎたらスキップ
  if (Math.abs(targetX - currentX) < 10) {
    wrap.classList.remove("walking");
    _mascot_schedule_walk();
    return;
  }

  const actuallyGoLeft = targetX < currentX;

  // キャラ反転（デフォルト左向き → 右に歩くとき反転）
  if (actuallyGoLeft) {
    el.style.transform = "";
  } else {
    el.style.transform = "scaleX(-1)";
  }

  // 移動（CSSトランジションで）
  wrap.style.left = targetX + "px";

  // 歩行完了後 → 待機に戻る
  const walkDuration = 2500;
  setTimeout(() => {
    if (!document.getElementById("pixel_mascot_wrap")) return;
    wrap.classList.remove("walking");
    el.style.transform = "";
    // 次の歩行をスケジュール
    _mascot_schedule_walk();
  }, walkDuration + 500);
}

function _dismiss_mascot() {
  if (_mascot_timer) { clearInterval(_mascot_timer); _mascot_timer = null; }
  if (_mascot_walk_timer) { clearTimeout(_mascot_walk_timer); _mascot_walk_timer = null; }
  if (_mascot_pos_observer) { _mascot_pos_observer.disconnect(); _mascot_pos_observer = null; }
  const wrap = document.getElementById("pixel_mascot_wrap");
  if (!wrap) return;
  wrap.removeAttribute("id"); // 新規作成と競合しないようIDを外す
  wrap.classList.add("bye");
  setTimeout(() => wrap.remove(), 700);
}

function _create_pixel_mascot() {
  // 前回のタイマーをクリア
  if (_mascot_timer) { clearInterval(_mascot_timer); _mascot_timer = null; }

  const keys = Object.keys(_MASCOT_CHARS);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const char = _MASCOT_CHARS[key];
  const px_w = 4, px_h = 4; // 正方ピクセル
  const el = document.createElement("div");
  el.classList.add("pixel_mascot");
  el.title = char.title;

  // 初期フレーム描画
  let frame_idx = 0;
  el.style.boxShadow = _grid_to_shadow(char.frames[0], char.colors, px_w, px_h);
  el.style.width = px_w + "px";
  el.style.height = px_h + "px";

  // 目光グローレイヤー（glow_colorsが定義されている場合のみ）
  let glow_el = null;
  if (char.glow_colors) {
    glow_el = document.createElement("div");
    glow_el.classList.add("pixel_mascot", "mascot_eye_glow");
    glow_el.style.boxShadow = _grid_to_shadow(char.frames[0], char.glow_colors, px_w, px_h);
    glow_el.style.width = px_w + "px";
    glow_el.style.height = px_h + "px";
    glow_el.style.position = "absolute";
    glow_el.style.top = "0";
    glow_el.style.left = "0";
  }

  // フレームアニメーション（durations対応: 各フレームの表示tick数）
  if (char.frames.length > 1) {
    const interval = 1000 / (char.fps || 3);
    const durs = char.durations || char.frames.map(() => 1);
    const total_ticks = durs.reduce((a, b) => a + b, 0);
    let tick = 0;
    _mascot_timer = setInterval(() => {
      tick = (tick + 1) % total_ticks;
      let cum = 0;
      for (let i = 0; i < durs.length; i++) {
        cum += durs[i];
        if (tick < cum) {
          if (i !== frame_idx) {
            frame_idx = i;
            el.style.boxShadow = _grid_to_shadow(char.frames[i], char.colors, px_w, px_h);
            if (glow_el) {
              glow_el.style.boxShadow = _grid_to_shadow(char.frames[i], char.glow_colors, px_w, px_h);
            }
          }
          break;
        }
      }
    }, interval);
  }

  // コンテナに入れて返す
  const container = document.createElement("div");
  container.className = "mascot_container";
  container.style.position = "relative";
  container.appendChild(el);
  if (glow_el) container.appendChild(glow_el);
  return container;
}

async function show_new_chat_screen() {
  // 前画面の残骸を完全クリア
  reset_thread_ui();          // closed_banner / reopen_menu / composer 復元
  _dismiss_mascot();          // 既存マスコットを消す
  document.querySelector(".ob_archive_bubble")?.remove();
  // 会議モードUI残骸をクリア
  is_multi_mode = false;
  multi_participants = [];
  _clear_multi_mode_ui();
  document.querySelector(".nomination_panel")?.remove();
  document.querySelectorAll(".nomination_hint")?.forEach(el => el.remove());

  chat_el.innerHTML = "";
  title_pill.textContent = "EPL AI Chat UI";
  update_ov_badge(null);
  update_immersion_badge(null);
  _set_topbar_mode("new_chat");

  // アクター一覧を取得
  const res = await fetch("/api/actor");
  const data = await res.json();
  const actor_list = data.actor || [];
  const available_engines = data.available_engines || [];
  const multi_engine = available_engines.length >= 2;

  // 新規チャット画面を構築
  const screen = document.createElement("div");
  screen.classList.add("new_chat_screen");

  const title = document.createElement("div");
  title.classList.add("new_chat_title");
  title.textContent = t("new_chat_title");
  screen.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.classList.add("new_chat_subtitle");
  subtitle.textContent = t("new_chat_subtitle");
  screen.appendChild(subtitle);

  // Personal単位でグルーピング（OV除外）
  const groups = {};
  const non_ov = actor_list.filter(a => !a.is_ov);
  non_ov.forEach(a => {
    const pid = a.personal_id;
    if (!groups[pid]) groups[pid] = [];
    groups[pid].push(a);
  });

  // デフォルトは最初のアクター
  selected_actor_id = non_ov.length > 0 ? non_ov[0].actor_id : null;

  // 全人格を通してアクター（本体除く）が1人でもいれば、オンボーディング吹き出し不要
  const _any_actor_exists = non_ov.some(a => !a.is_default);

  const all_rows_container = document.createElement("div");
  all_rows_container.classList.add("new_chat_personal_groups");

  Object.keys(groups).forEach(pid => {
    const actors = groups[pid];
    const actor_row = document.createElement("div");
    actor_row.classList.add("new_chat_actor_row");

    // Personal別エンジンバッジ（複数エンジン利用可能時のみ表示）
    const personal_engine = actors[0]?.personal_engine || "";
    const default_engine = data.default_engine || "claude";
    if (multi_engine) {
    const _eid = personal_engine || default_engine;
    const _is_inherited = !personal_engine;
    // actor_row にエンジンクラスを付ける（CSS制御の親）
    actor_row.classList.add(_eid === "openai" ? "is_engine_openai" : _eid === "gemini" ? "is_engine_gemini" : "is_engine_claude");
    if (_is_inherited) actor_row.classList.add("is_engine_inherited");
    const engine_btn = document.createElement("button");
    engine_btn.classList.add("new_chat_engine_btn");
    const _elabel = _eid === "openai" ? "GPT" : _eid === "gemini" ? "Gemini" : "Claude";
    engine_btn.title = _elabel + (_is_inherited ? " (default)" : "") + " — Click to switch";
    engine_btn.textContent = _eid === "openai" ? "G" : _eid === "gemini" ? "Gm" : "C";
    engine_btn.dataset.pid = pid;
    engine_btn.dataset.engine = _eid;
    engine_btn.dataset.inherited = _is_inherited ? "1" : "";
    engine_btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const current = engine_btn.dataset.engine;
      const _engine_cycle = available_engines.length > 0 ? available_engines : ["claude"];
      const _ci = _engine_cycle.indexOf(current);
      const next = _engine_cycle[(_ci + 1) % _engine_cycle.length];
      try {
        const res = await fetch(`/api/personal/${pid}/engine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine: next }),
        });
        if (res.ok) {
          engine_btn.dataset.engine = next;
          engine_btn.textContent = next === "openai" ? "G" : next === "gemini" ? "Gm" : "C";
          engine_btn.title = next === "openai" ? "GPT — Click to switch" : next === "gemini" ? "Gemini — Click to switch" : "Claude — Click to switch";
          engine_btn.dataset.inherited = "";
          // actor_row のクラスを切り替え
          actor_row.classList.remove("is_engine_claude", "is_engine_openai", "is_engine_gemini", "is_engine_inherited");
          actor_row.classList.add(next === "openai" ? "is_engine_openai" : next === "gemini" ? "is_engine_gemini" : "is_engine_claude");
          const sel_actor = non_ov.find(a => a.actor_id === selected_actor_id);
          if (sel_actor && String(sel_actor.personal_id) === String(pid)) {
            // エンジンバッジ直接更新（新規チャット画面ではchat_thread_id未確定のため）
            const _next_label = next === "openai" ? "GPT" : next === "gemini" ? "Gemini" : "Claude";
            engine_badge.textContent = `${_next_label} / auto`;
            // 送信ボタンも連動
            document.body.classList.remove("send_engine_claude", "send_engine_openai", "send_engine_gemini", "send_engine_openrouter");
            document.body.classList.add(next === "openai" ? "send_engine_openai" : next === "gemini" ? "send_engine_gemini" : "send_engine_claude");
            // テーマ色も連動（会議テーマも除去）
            document.body.classList.remove("theme_none", "theme_claude", "theme_openai", "theme_gemini", "theme_meeting_even", "theme_meeting_odd", "theme_meeting_hot");
            document.body.classList.add(next === "openai" ? "theme_openai" : next === "gemini" ? "theme_gemini" : "theme_claude");
            update_memory_layer_panel();
          }
        }
      } catch (ex) {
        console.error(`[ENGINE] fetch failed:`, ex);
      }
    });
    actor_row.appendChild(engine_btn);
    } // end if (multi_engine)

    actors.forEach((a, idx) => {
      const btn = document.createElement("button");
      btn.classList.add("new_chat_actor_btn");
      // モードアクター（is_unnamed + role_name）はrole_nameを表示
      btn.textContent = (a.is_unnamed && a.role_name) ? a.role_name : (a.name || t("new_chat_unnamed"));

      // 各グループの最初のアクター（本体）は特別カラー
      if (idx === 0) {
        btn.classList.add("new_chat_actor_primary");
      }

      // デフォルト選択
      if (a.actor_id === selected_actor_id) {
        btn.classList.add("selected");
      }

      btn.addEventListener("click", () => {
        // 全グループの選択状態をリセット
        all_rows_container.querySelectorAll(".new_chat_actor_btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        selected_actor_id = a.actor_id;
        _set_title_pill(a);
        update_immersion_badge(a);
        // 入力欄のプレースホルダーをエンジンに連動
        const _pe = a.personal_engine || default_engine;
        const _en = _pe === "openai" ? "GPT" : _pe === "gemini" ? "Gemini" : "Claude";
        input_el.placeholder = `Ask Epel (${_en})`;
        // 送信ボタンのエンジン色を切り替え
        document.body.classList.remove("send_engine_claude", "send_engine_openai", "send_engine_gemini", "send_engine_openrouter");
        document.body.classList.add(_pe === "openai" ? "send_engine_openai" : _pe === "gemini" ? "send_engine_gemini" : "send_engine_claude");
        // テーマ色を連動（会議テーマも除去）
        document.body.classList.remove("theme_none", "theme_claude", "theme_openai", "theme_gemini", "theme_meeting_even", "theme_meeting_odd", "theme_meeting_hot");
        document.body.classList.add(_pe === "openai" ? "theme_openai" : _pe === "gemini" ? "theme_gemini" : "theme_claude");
        // エンジンバッジテキスト更新
        engine_badge.textContent = `${_en} / auto`;
        update_memory_layer_panel();
      });

      actor_row.appendChild(btn);
    });

    // 各Personalグループに＋ボタン（新規アクター追加）
    const add_actor_btn = document.createElement("button");
    add_actor_btn.classList.add("new_chat_actor_btn", "new_chat_actor_add");
    add_actor_btn.textContent = "+";
    add_actor_btn.title = t("new_actor");
    const _pid = parseInt(pid);
    add_actor_btn.addEventListener("click", () => {
      show_init_modal("actor", _pid);
    });
    // ＋ボタンを relative にしてバルーンの起点にする
    add_actor_btn.style.position = "relative";
    actor_row.appendChild(add_actor_btn);

    // オンボーディング: アクター1人（本体のみ） → 吹き出し表示
    if (actors.length <= 1 && !_any_actor_exists && !localStorage.getItem("ob_actor_seen")) {
      const bubble = document.createElement("span");
      bubble.className = "onboarding_bubble onboarding_bubble_actor";
      bubble.textContent = t("ob_try_actor") || "アクターを作ってみよう";
      add_actor_btn.appendChild(bubble);
    }

    all_rows_container.appendChild(actor_row);
  });

  // ＋新しい人格を作るボタン（隠し機能：将来公開）
  const add_personal_btn = document.createElement("button");
  add_personal_btn.classList.add("new_chat_add_personal");
  add_personal_btn.textContent = t("new_personal");
  add_personal_btn.addEventListener("click", () => {
    show_init_modal("personal");
  });
  // 常に表示（新しい人格はいつでも作れる）
  add_personal_btn.style.position = "relative";
  all_rows_container.appendChild(add_personal_btn);

  // オンボーディング: 人格1つだけ & アクター作成済み → ２人目の人格を促す
  const _personal_count = Object.keys(groups).length;
  const _has_created_actor = localStorage.getItem("ob_actor_seen") === "1";
  if (_personal_count === 1 && _has_created_actor && !localStorage.getItem("ob_personal_seen")) {
    const bubble2 = document.createElement("span");
    bubble2.className = "onboarding_bubble onboarding_bubble_personal";
    bubble2.textContent = t("ob_try_personal") || "2人目を作ってみよう";
    add_personal_btn.appendChild(bubble2);
  }

  // デフォルトエンジン表示（複数エンジン利用可能時のみ）
  if (multi_engine) {
    const default_row = document.createElement("div");
    default_row.classList.add("new_chat_default_engine");
    const _de = data.default_engine || "claude";
    const _de_label = _de === "openai" ? "GPT" : _de === "gemini" ? "Gemini" : "Claude";
    default_row.innerHTML = `<span class="default_engine_label">Default: <strong>${_de_label}</strong></span>`;
    const switch_btn = document.createElement("button");
    switch_btn.classList.add("default_engine_switch");
    switch_btn.textContent = "switch";
    switch_btn.addEventListener("click", async () => {
      const current_de = default_row.dataset.engine || _de;
      const _de_cycle = available_engines.length > 0 ? available_engines : ["claude"];
      const _di = _de_cycle.indexOf(current_de);
      const next_de = _de_cycle[(_di + 1) % _de_cycle.length];
      const res = await fetch("/api/engine/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: next_de }),
      });
      if (res.ok) {
        default_row.dataset.engine = next_de;
        const label = next_de === "openai" ? "GPT" : next_de === "gemini" ? "Gemini" : "Claude";
        default_row.querySelector(".default_engine_label").innerHTML = `Default: <strong>${label}</strong>`;
        // 継承中のバッジを更新
        all_rows_container.querySelectorAll('.new_chat_engine_btn[data-inherited="1"]').forEach(btn => {
          btn.textContent = next_de === "openai" ? "G" : next_de === "gemini" ? "Gm" : "C";
          btn.dataset.engine = next_de;
          // 親 actor_row のクラスを切り替え
          const row = btn.closest(".new_chat_actor_row");
          if (row) {
            row.classList.remove("is_engine_claude", "is_engine_openai", "is_engine_gemini");
            row.classList.add(next_de === "openai" ? "is_engine_openai" : next_de === "gemini" ? "is_engine_gemini" : "is_engine_claude");
          }
        });
      }
    });
    default_row.appendChild(switch_btn);
    all_rows_container.appendChild(default_row);
  }

  screen.appendChild(all_rows_container);
  chat_el.appendChild(screen);

  // ドット絵マスコット（magic_wordsの上に挿入）
  _spawn_mascot();

  // 最初のアクターをタイトルに反映 + 入力欄のエンジン表示
  if (non_ov.length > 0) {
    _set_title_pill(non_ov[0]);
    update_immersion_badge(non_ov[0]);
    const _first_engine = non_ov[0].personal_engine || (data.default_engine || "claude");
    input_el.placeholder = `Ask Epel (${_first_engine === "openai" ? "GPT" : _first_engine === "gemini" ? "Gemini" : "Claude"})`;
    // 送信ボタンの初期エンジン色
    document.body.classList.remove("send_engine_claude", "send_engine_openai", "send_engine_gemini", "send_engine_openrouter");
    document.body.classList.add(_first_engine === "openai" ? "send_engine_openai" : _first_engine === "gemini" ? "send_engine_gemini" : "send_engine_claude");
    // テーマ色も連動（他画面から遷移時に正しい色になるよう。会議テーマも除去）
    document.body.classList.remove("theme_none", "theme_claude", "theme_openai", "theme_gemini", "theme_meeting_even", "theme_meeting_odd", "theme_meeting_hot");
    document.body.classList.add(_first_engine === "openai" ? "theme_openai" : _first_engine === "gemini" ? "theme_gemini" : "theme_claude");
    // エンジンバッジテキスト更新
    const _first_en_label = _first_engine === "openai" ? "GPT" : _first_engine === "gemini" ? "Gemini" : "Claude";
    engine_badge.textContent = `${_first_en_label} / auto`;
    update_memory_layer_panel();
  }
}

// 送信時に新規チャット画面の場合はactor切替を行う
const original_send = send_message;

// send_messageをラップ（新規チャット画面対応）
async function handle_new_chat_send() {
  if (document.querySelector(".new_chat_screen") && selected_actor_id) {
    // actor切替
    const switch_res = await fetch(`/api/actor/switch/${selected_actor_id}`, { method: "POST" });
    const switch_data = await switch_res.json();
    if (switch_res.ok) {
      chat_thread_id = switch_data.chat_thread_id;
      // 新規チャット画面を除去
      const ncs = document.querySelector(".new_chat_screen");
      if (ncs) ncs.remove();
      _dismiss_mascot();
      _set_topbar_mode("chat");
      update_memory_layer_panel();
    }
  }
}

// ========== 汎用モーダル ==========

const common_modal = document.getElementById("common_modal");
const common_modal_title = document.getElementById("common_modal_title");
const common_modal_body = document.getElementById("common_modal_body");
const common_modal_close = document.getElementById("common_modal_close");

function open_modal(title, body_html) {
  common_modal_title.textContent = title;
  common_modal_body.innerHTML = body_html;
  common_modal.style.display = "flex";
}

function close_modal() {
  common_modal.style.display = "none";
  common_modal_body.innerHTML = "";
}

common_modal_close?.addEventListener("click", close_modal);
common_modal?.addEventListener("click", (e) => {
  if (e.target === common_modal) close_modal();
});

// ========== チャットスレッド設定 ==========

function get_share_level_label() {
  return {
    "0": t("share_lv0"),
    "1": t("share_lv1"),
    "2": t("share_lv2"),
    "3": t("share_lv3"),
    "4": t("share_lv4"),
  };
}

async function open_chat_thread_setting() {
  if (!chat_thread_id) {
    add_system_message(t("chat_start_first"));
    return;
  }
  // 現在の共有レベルを取得
  const res = await fetch(`/api/setting/chat_thread_share_level:${chat_thread_id}`);
  const data = await res.json();
  const current_level = data.value || "2";

  const options = Object.entries(get_share_level_label())
    .map(([val, label]) => `<option value="${val}" ${val === current_level ? "selected" : ""}>${label}</option>`)
    .join("");

  // 会議モード: 記憶レベルを取得
  let current_mem_level = 0;
  if (is_multi_mode) {
    try {
      const ml_res = await fetch(`/api/multi/participants?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
      const ml_data = await ml_res.json();
      current_mem_level = ml_data.meeting_lv || 0;
    } catch (e) { /* ignore */ }
  }

  // Ov一覧を取得
  const ov_res = await fetch(`/api/ov/list?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
  const ov_data = await ov_res.json();
  const ov_list = ov_data.ov_list || [];
  const current_ov = current_ov_info ? current_ov_info.actor_id : "";
  const ov_options = [`<option value="" ${!current_ov ? "selected" : ""}>${t("ov_none")}</option>`]
    .concat(ov_list.map(ov => `<option value="${ov.actor_id}" ${ov.actor_id == current_ov ? "selected" : ""}>${ov.name}</option>`))
    .join("");

  // LUGJ状態を取得
  const lugj_res = await fetch(`/api/setting/lugj_enabled:${chat_thread_id}`);
  const lugj_data = await lugj_res.json();
  const lugj_on = lugj_data.value !== "0";

  // エンジン・モデル一覧を取得
  const key_status_res = await fetch("/api/api_key_status");
  const key_status = await key_status_res.json();
  const _cs_engines = ["claude", "openai", "gemini", "openrouter"].filter(e => !!key_status[e]);

  const model_res = await fetch(`/api/model?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
  const model_data = await model_res.json();
  const current_engine = model_data.engine || "claude";
  let current_model = model_data.model_mode || model_data.model || "";
  let available_models = model_data.available || [];
  // OpenRouter: 推奨アイコン + 並べ替え
  if (current_engine === "openrouter") {
    const _rec = await _fetch_openrouter_recommended();
    available_models = _apply_openrouter_decorations(available_models, _rec);
  }
  // auto/auto_fullが選択肢にない場合（GPT等）、先頭モデルをデフォルトにする
  if (!available_models.some(m => m.id === current_model) && available_models.length > 0) {
    current_model = available_models[0].id;
  }
  const model_options = available_models
    .map(m => `<option value="${m.id}" ${m.id === current_model ? "selected" : ""}>${m.label}</option>`)
    .join("");
  const _engine_labels = { claude: "Claude", openai: "GPT", gemini: "Gemini", openrouter: "OpenRouter" };
  const engine_options = _cs_engines
    .map(e => `<option value="${e}" ${e === current_engine ? "selected" : ""}>${_engine_labels[e] || e}</option>`)
    .join("");

  // トークン統計を取得（スレッド単位）
  const stats_res = await fetch(`/api/token_log/stats?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
  const stats = await stats_res.json();
  const total_tok = (stats.total_tokens || 0).toLocaleString();
  const call_count = stats.call_count || 0;
  const total_cost_local = _format_local_cost(stats.total_cost_usd || 0);
  const by_model_html = (stats.by_model || []).map(m => {
    const tok = (m.input_tokens + m.output_tokens).toLocaleString();
    const short = m.model.replace("claude-", "").replace("-20251001", "").replace("-20250514", "");
    const cost = _format_local_cost(m.cost_usd || 0);
    return `<div class="token_stat_row"><span>${short}</span><span>${tok} tok / ${m.calls}${t("cs_tokens_unit")} (${cost})</span></div>`;
  }).join("") || `<div class='token_stat_row'>${t("cs_no_data")}</div>`;
  // キャッシュ節約行（このスレッド単位）
  const _cache_read = stats.total_cache_read_tokens || 0;
  const _cache_saved_jpy = stats.cache_saved_jpy || 0;
  const _cache_hit = stats.cache_hit_ratio || 0;
  const cache_html = _cache_read > 0
    ? `<div class="token_stat_row" style="color:#7ae0a0;border-top:1px dashed #2a5a3a;margin-top:4px;padding-top:6px;">
         <span>🍞 ${t("ts_cache_saved")}</span>
         <span>−¥${_cache_saved_jpy.toLocaleString()}（ヒット率 ${(_cache_hit*100).toFixed(1)}%）</span>
       </div>`
    : "";

  open_modal(t("cs_title"), `
    ${is_multi_mode ? "" : `${_cs_engines.length >= 2 ? `<div class="modal_field">
      <div class="modal_field_label">${t("cs_engine") || "エンジン"}</div>
      <select class="modal_select" id="engine_select">${engine_options}</select>
      <div class="modal_hint">${t("cs_engine_hint") || "チャットで使用するAIエンジンを切り替えます。"}</div>
    </div>` : ""}
    <div class="modal_field">
      <div class="modal_field_label">${t("cs_model")}</div>
      <select class="modal_select" id="model_select">${model_options}</select>
      <div class="modal_hint" id="model_hint_text">${current_engine === "openai" ? t("cs_model_hint_openai") : current_engine === "gemini" ? t("cs_model_hint_gemini") : current_engine === "openrouter" ? (t("cs_model_hint_openrouter") || "") : t("cs_model_hint_claude")}</div>
    </div>`}
    ${is_multi_mode ? `<div class="modal_field">
      <div class="modal_field_label">${t("cs_meeting_settings") || "会議設定"}</div>
      <button class="modal_btn_accent" id="btn_open_meeting_settings" style="background:var(--accent);color:#000;border:none;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer;font-size:0.85rem;">${t("cs_meeting_settings_btn") || "参加者・エンジン設定を開く ⚙"}</button>
      <div class="modal_hint">${t("cs_meeting_settings_hint") || "参加者の入退室やエンジン・モデルの変更ができます。"}</div>
    </div>` : ""}
    <div class="modal_field">
      <div class="modal_field_label">${t("cs_tokens")}</div>
      <div class="token_stats_box">
        <div class="token_stat_total">${t("cs_tokens_total").replace("{tok}", total_tok).replace("{count}", call_count)}　≈ ${total_cost_local}</div>
        ${by_model_html}
        ${cache_html}
      </div>
    </div>
    ${is_multi_mode ? `<div class="modal_field">
      <div class="modal_field_label">${t("meeting_memory_level")}</div>
      <select class="modal_select" id="meeting_mem_level_select">
        <option value="0">${t("meeting_mem_lv0")}</option>
        <option value="1">${t("meeting_mem_lv1")}</option>
        <option value="2">${t("meeting_mem_lv2")}</option>
      </select>
      <div class="modal_hint">${t("meeting_memory_hint")}</div>
    </div>` : `<div class="modal_field">
      <div class="modal_field_label">${t("cs_share_level")}</div>
      <select class="modal_select" id="share_level_select">${options}</select>
      <div class="modal_hint">${t("cs_share_hint")}</div>
    </div>
    <div class="modal_field">
      <div class="modal_field_label">${t("cs_overlay")}</div>
      <select class="modal_select" id="ov_select">${ov_options}</select>
      <div class="modal_hint">${t("cs_overlay_hint")}</div>
    </div>`}
    <div class="modal_field">
      <div class="modal_field_label">${t("cs_lugj")}</div>
      <label class="modal_toggle_label">
        <input type="checkbox" id="lugj_toggle" ${lugj_on ? "checked" : ""}>
        <span>${lugj_on ? t("cs_lugj_on") : t("cs_lugj_off")}</span>
      </label>
      <div class="modal_hint">${t("cs_lugj_hint")}</div>
    </div>
    <div class="modal_field modal_danger_zone">
      <button class="modal_btn_danger" id="delete_chat_btn">${t("cs_delete_chat")}</button>
    </div>
  `);

  // 会議設定ボタン
  document.getElementById("btn_open_meeting_settings")?.addEventListener("click", () => {
    close_modal();
    _show_meeting_edit_modal();
  });

  // 会議記憶レベル: 現在値をセット＋変更時に保存
  const mem_level_sel = document.getElementById("meeting_mem_level_select");
  if (mem_level_sel) {
    mem_level_sel.value = String(current_mem_level);
    mem_level_sel.addEventListener("change", async (e) => {
      const lv = parseInt(e.target.value);
      await fetch("/api/multi/update_participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_thread_id, participants: multi_participants.map(p => ({
          actor_id: p.actor_id, personal_id: p.personal_id,
          engine_id: p.engine_id || "", model_id: p.model_id || "",
          color: p.color || "", role: p.role || "member",
        })), meeting_lv: lv, lang: get_lang() }),
      });
      const lv_labels = { 0: t("meeting_mem_lv0"), 1: t("meeting_mem_lv1"), 2: t("meeting_mem_lv2") };
      add_system_message(t("meeting_mem_changed").replace("{name}", lv_labels[lv] || `Lv${lv}`));
    });
  }

  // モデル変更時
  // エンジン変更
  document.getElementById("engine_select")?.addEventListener("change", async (e) => {
    const new_engine = e.target.value;
    const res = await fetch(`/api/switch_engine/${new_engine}?chat_thread_id=${encodeURIComponent(chat_thread_id)}`, { method: "POST" });
    const data = await res.json();
    if (res.ok && data.status === "ok") {
      add_system_message((t("cs_engine_changed") || "エンジンを {name} に変更しました").replace("{name}", data.engine_name || new_engine));
      setTimeout(() => scroll_to_bottom(true), 100);  // 強制スクロール
      // モデル一覧を更新
      const model_sel = document.getElementById("model_select");
      if (model_sel) {
        const models = await _fetch_mp_models(new_engine);
        // Claude: Auto系を先頭に追加
        const auto_entries = new_engine === "claude" ? [
          {id: "auto", label: "Auto（推奨）"},
          {id: "auto_full", label: "Auto+"},
        ] : [];
        const all_models = [...auto_entries, ...models.filter(m => !m.id.startsWith("auto"))];
        model_sel.innerHTML = all_models.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
        // デフォルト選択
        model_sel.value = new_engine === "claude" ? "auto" : (all_models[0]?.id || "");
        // モデルも設定
        const set_res = await fetch(`/api/model?chat_thread_id=${encodeURIComponent(chat_thread_id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: model_sel.value }),
        });
        // モデルヒント文もエンジン別に更新
        const _hint_el = document.getElementById("model_hint_text");
        if (_hint_el) {
          const _hint_key = "cs_model_hint_" + new_engine;
          _hint_el.textContent = t(_hint_key) || "";
        }
      }
      await update_engine_badge();
    } else {
      add_system_message(data.error || "エンジン切替に失敗しました");
      e.target.value = current_engine;  // 元に戻す
    }
  });

  // モデル変更
  document.getElementById("model_select")?.addEventListener("change", async (e) => {
    const model_id = e.target.value;
    const res = await fetch(`/api/model?chat_thread_id=${encodeURIComponent(chat_thread_id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model_id }),
    });
    const data = await res.json();
    if (data.status === "ok") {
      const label = available_models.find(m => m.id === model_id)?.label || model_id;
      add_system_message(t("cs_model_changed").replace("{name}", label));
      setTimeout(() => scroll_to_bottom(true), 100);  // 強制スクロール
      update_engine_badge();
    }
  });

  // 共有レベル変更時に即保存
  document.getElementById("share_level_select")?.addEventListener("change", async (e) => {
    const level = e.target.value;
    await fetch(`/api/setting/chat_thread_share_level:${chat_thread_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: level }),
    });
    add_system_message(t("cs_share_changed").replace("{name}", get_share_level_label()[level]));
  });

  // LUGJ切替時
  document.getElementById("lugj_toggle")?.addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    await fetch(`/api/setting/lugj_enabled:${chat_thread_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: enabled ? "1" : "0" }),
    });
    e.target.nextElementSibling.textContent = enabled ? t("cs_lugj_on") : t("cs_lugj_off");
    add_system_message(enabled ? t("cs_lugj_enabled") : t("cs_lugj_disabled"));
  });

  // Ov変更時
  document.getElementById("ov_select")?.addEventListener("change", async (e) => {
    const ov_id = e.target.value;
    if (ov_id) {
      const res = await fetch(`/api/ov/set/${ov_id}?chat_thread_id=${encodeURIComponent(chat_thread_id)}`, { method: "POST" });
      const data = await res.json();
      update_ov_badge(data.ov_info);
      add_system_message(t("cs_ov_applied").replace("{name}", data.ov_info.name));
    } else {
      await fetch(`/api/ov/clear?chat_thread_id=${encodeURIComponent(chat_thread_id)}`, { method: "POST" });
      update_ov_badge(null);
      add_system_message(t("cs_ov_cleared"));
    }
  });

  // チャット削除
  document.getElementById("delete_chat_btn")?.addEventListener("click", () => {
    close_modal();
    confirm_delete_chat(chat_thread_id, t("cs_delete_chat"));
  });
}

document.getElementById("btn_session_setting")?.addEventListener("click", open_chat_thread_setting);

// ========== Trash Modal ==========
const trash_modal_el = document.getElementById("trash_modal");

async function show_trash_modal() {
  trash_modal_el.style.display = "flex";
  await load_trash_list();
}

function hide_trash_modal() {
  trash_modal_el.style.display = "none";
}

async function load_trash_list() {
  const list_el = document.getElementById("trash_list");
  const empty_el = document.getElementById("trash_empty");
  if (!list_el) return;
  list_el.innerHTML = `<div style="color:#555;font-size:0.82rem;padding:8px;">${t("memo_loading")}</div>`;
  try {
    const res = await fetch(`/api/trash?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
    const data = await res.json();
    const items = data.trash || [];
    list_el.innerHTML = "";
    if (items.length === 0) {
      list_el.style.display = "none";
      empty_el.style.display = "block";
      return;
    }
    list_el.style.display = "flex";
    empty_el.style.display = "none";
    items.forEach((tr) => {
      const row = document.createElement("div");
      row.className = "trash_item";
      const label_text = tr.title || tr.chat_thread_id;
      const deleted_date = tr.deleted_at ? tr.deleted_at.replace("T", " ").replace("Z", "").slice(0, 16) : "";
      row.innerHTML = `
        <div class="trash_item_info">
          <div class="trash_item_title">${escape_html(label_text)}</div>
          <div class="trash_item_meta">${deleted_date} · ${tr.msg_count}${t("ts_calls_unit") ? t("ts_calls_unit") : ""}</div>
        </div>
        <div class="trash_item_actions">
          <button class="trash_btn_restore" data-id="${tr.chat_thread_id}" title="${t("trash_restore")}">
            <svg viewBox="0 0 24 24" class="svg_icon" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
            </svg>
          </button>
          <button class="trash_btn_purge" data-id="${tr.chat_thread_id}" title="${t("trash_delete")}">
            <svg viewBox="0 0 24 24" class="svg_icon" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>
        </div>
      `;
      row.querySelector(".trash_btn_restore").addEventListener("click", async () => {
        await trash_restore(tr.chat_thread_id);
      });
      row.querySelector(".trash_btn_purge").addEventListener("click", async () => {
        await trash_purge(tr.chat_thread_id, label_text);
      });
      list_el.appendChild(row);
    });
  } catch (e) {
    list_el.innerHTML = `<div style="color:#e74c3c;font-size:0.82rem;padding:8px;">${t("ts_error")}</div>`;
  }
}

async function trash_restore(thread_id) {
  try {
    const res = await fetch(`/api/chat_thread/${thread_id}/restore`, { method: "POST" });
    if (res.ok) {
      await load_trash_list();
      await load_sidebar_chats();
      if (chat_thread_id === thread_id) {
        // 現在表示中のスレッドを復元 → リロードリンクを表示
        add_system_message(
          `${t("trash_restored")}<br><a href="#" onclick="location.reload();return false;" style="color:var(--accent);">${t("trash_reload")} →</a>`,
          {raw_html: true}
        );
        set_composer_disabled(false);
      } else {
        add_system_message(
          `${t("trash_restored")}<br><a href="/chat/${thread_id}" style="color:var(--accent);">${t("trash_open_restored")} →</a>`,
          {raw_html: true}
        );
      }
    }
  } catch (e) {}
}

async function trash_purge(thread_id, label) {
  const confirmed = await show_confirm(t("trash_purge_confirm").replace("{name}", label));
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/chat_thread/${thread_id}/purge`, { method: "DELETE" });
    if (res.ok) {
      await load_trash_list();
      add_system_message(t("trash_purged"));
    }
  } catch (e) {}
}

document.getElementById("btn_trash")?.addEventListener("click", () => {
  sidebar_el.classList.remove("is_open");
  const ov = document.querySelector(".sidebar_overlay");
  if (ov) ov.classList.remove("is_visible");
  show_trash_modal();
});

// ========== Token Stats Modal ==========
const token_stats_modal_el = document.getElementById("token_stats_modal");

async function show_token_stats_modal() {
  token_stats_modal_el.style.display = "flex";
  await load_token_stats();
}

function hide_token_stats_modal() {
  token_stats_modal_el.style.display = "none";
}

async function load_token_stats() {
  const body = document.getElementById("token_stats_body");
  if (!body) return;
  body.innerHTML = `<div style="color:#555;font-size:0.82rem;text-align:center;padding:24px 0;">${t("memo_loading")}</div>`;
  try {
    const res = await fetch("/api/token_log/stats");
    const d = await res.json();

    const total_in = d.total_input_tokens || 0;
    const total_out = d.total_output_tokens || 0;
    const total_calls = d.call_count || 0;
    const total_cost = d.total_cost_usd || 0;
    const total_jpy = d.total_cost_jpy || 0;
    const month_cost = d.this_month_cost_usd || 0;
    const month_jpy = d.this_month_cost_jpy || 0;
    const avg_in = total_calls > 0 ? Math.round(total_in / total_calls) : 0;
    // 1発言あたり平均（呼び出し1回 = AI応答1発言）
    const avg_per_call_jpy = total_calls > 0 ? (total_jpy / total_calls) : 0;
    const avg_per_call_usd = total_calls > 0 ? (total_cost / total_calls) : 0;
    // 1ラリー = ユーザー発言1＋AI応答1。会議モードでは1ラリーに複数呼び出しが入るが、
    // 単純に2回の呼び出しを1ラリーと見なす近似
    const avg_per_rally_jpy = avg_per_call_jpy;  // 現状 call == ラリー（ユーザー発言1つ=token_log1件）
    const avg_per_rally_usd = avg_per_call_usd;
    // キャッシュ統計
    const cache_saved_jpy = d.cache_saved_jpy || 0;
    const cache_saved_usd = d.cache_saved_usd || 0;
    const cache_hit = d.cache_hit_ratio || 0;
    const cache_read = d.total_cache_read_tokens || 0;
    const _u = t("ts_calls_unit");

    const rows = [];

    // サマリーカード (2x2)
    rows.push(`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="ts_card">
          <div class="ts_label">${t("ts_total_cost")}</div>
          <div class="ts_value" style="color:#f0a500;">$${total_cost.toFixed(3)} <span style="font-size:0.7rem;color:#888;">≈ ¥${total_jpy.toLocaleString()}</span></div>
        </div>
        <div class="ts_card">
          <div class="ts_label">${t("ts_month_cost")}</div>
          <div class="ts_value" style="color:#f0a500;">$${month_cost.toFixed(3)} <span style="font-size:0.7rem;color:#888;">≈ ¥${month_jpy.toLocaleString()}</span></div>
        </div>
        <div class="ts_card">
          <div class="ts_label">${t("ts_call_count")}</div>
          <div class="ts_value">${total_calls.toLocaleString()} ${_u}</div>
        </div>
        <div class="ts_card">
          <div class="ts_label">${t("ts_avg_input")}</div>
          <div class="ts_value">${avg_in.toLocaleString()} tok</div>
        </div>
      </div>
    `);

    // 平均単価カード (1発言 / 1ラリー)
    rows.push(`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="ts_card">
          <div class="ts_label">${t("ts_avg_per_call")}</div>
          <div class="ts_value" style="color:#6bcfff;">¥${avg_per_call_jpy.toFixed(2)} <span style="font-size:0.7rem;color:#888;">$${avg_per_call_usd.toFixed(4)}</span></div>
        </div>
        <div class="ts_card">
          <div class="ts_label">${t("ts_avg_per_rally")}</div>
          <div class="ts_value" style="color:#6bcfff;">¥${avg_per_rally_jpy.toFixed(2)} <span style="font-size:0.7rem;color:#888;">$${avg_per_rally_usd.toFixed(4)}</span></div>
        </div>
      </div>
    `);

    // キャッシュ節約バッジ（節約0円でも表示してcache未発火を見せる）
    if (cache_read > 0 || cache_saved_jpy > 0) {
      rows.push(`
        <div style="background:linear-gradient(135deg,#1a2a1e 0%,#0f1a12 100%);border:1px solid #2a5a3a;border-radius:8px;padding:12px 14px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;">
          <div>
            <div style="font-size:0.7rem;color:#7ae0a0;letter-spacing:0.1em;font-weight:bold;">${t("ts_cache_saved")}</div>
            <div style="font-size:0.68rem;color:#558;margin-top:4px;">
              ${t("ts_cache_hit")}: <span style="color:#7ae0a0;">${(cache_hit*100).toFixed(1)}%</span>
              · read: ${cache_read.toLocaleString()} tok
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.1rem;color:#7ae0a0;font-weight:bold;">¥${cache_saved_jpy.toLocaleString()}</div>
            <div style="font-size:0.68rem;color:#558;">$${cache_saved_usd.toFixed(3)}</div>
          </div>
        </div>
      `);
    } else {
      // キャッシュ未発火の案内（Claudeエンジン推奨）
      rows.push(`
        <div style="background:#111;border:1px dashed #333;border-radius:8px;padding:10px 14px;font-size:0.72rem;color:#666;text-align:center;">
          ${t("ts_cache_saved")}: — <span style="color:#444;">（Claude直APIで自動発火）</span>
        </div>
      `);
    }

    // モデル別
    if ((d.by_model || []).length > 0) {
      const model_rows = d.by_model.map(m => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#111;border-radius:6px;border:1px solid #1e1e1e;">
          <div>
            <div style="font-size:0.78rem;color:#aaa;">${m.model.replace("claude-","").replace("-20251001","")}</div>
            <div style="font-size:0.7rem;color:#555;margin-top:2px;">${m.calls}${_u} · in:${m.input_tokens.toLocaleString()} / out:${m.output_tokens.toLocaleString()}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.85rem;color:#f0a500;font-weight:bold;">$${m.cost_usd.toFixed(3)}</div>
            <div style="font-size:0.7rem;color:#666;">≈ ¥${(m.cost_jpy||0).toLocaleString()}</div>
          </div>
        </div>
      `).join("");
      rows.push(`
        <div>
          <div style="font-size:0.65rem;color:#f0a500;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">${t("ts_by_model")}</div>
          <div style="display:flex;flex-direction:column;gap:6px;">${model_rows}</div>
        </div>
      `);
    }

    // コストシミュレーション
    const sim = d.cost_simulation || {};
    if (sim.haiku || sim.sonnet || sim.opus) {
      rows.push(`
        <div>
          <div style="font-size:0.65rem;color:#f0a500;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">${t("ts_simulation")}</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${["haiku","sonnet","opus"].filter(k=>sim[k]).map(k=>`
              <div style="display:flex;justify-content:space-between;padding:6px 12px;background:#111;border-radius:6px;border:1px solid #1e1e1e;">
                <span style="color:#aaa;font-size:0.78rem;">${k.charAt(0).toUpperCase()+k.slice(1)}</span>
                <span style="color:#f0a500;font-size:0.78rem;">$${sim[k].cost_usd.toFixed(3)} <span style="color:#666;">≈ ¥${sim[k].cost_jpy.toLocaleString()}</span></span>
              </div>`).join("")}
          </div>
        </div>
      `);
    }

    // 直近の呼び出し
    const recent = (d.recent || []).slice(0, 8);
    if (recent.length > 0) {
      const recent_rows = recent.map(r => {
        const dt = r.created_at ? r.created_at.slice(0, 16).replace("T", " ") : "";
        const model_short = (r.model||"").replace("claude-","").replace("-20251001","").replace("-4-6","");
        return `
          <div style="display:grid;grid-template-columns:1fr auto auto auto;gap:6px;align-items:center;padding:6px 10px;background:#111;border-radius:6px;border:1px solid #1a1a1a;font-size:0.72rem;">
            <div style="color:#555;">${dt}</div>
            <div style="color:#777;">${model_short}</div>
            <div style="color:#888;">in:${r.input_tokens.toLocaleString()}</div>
            <div style="color:#f0a500;">¥${(r.cost_jpy||0).toFixed(1)}</div>
          </div>
        `;
      }).join("");
      rows.push(`
        <div>
          <div style="font-size:0.65rem;color:#f0a500;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">${t("ts_recent")}</div>
          <div class="ts_log_list" style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;">${recent_rows}</div>
        </div>
      `);
    }

    body.innerHTML = rows.join("");
  } catch (e) {
    body.innerHTML = `<div style="color:#e74c3c;font-size:0.82rem;text-align:center;padding:24px 0;">${t("ts_error")}</div>`;
  }
}

document.getElementById("btn_token_stats")?.addEventListener("click", () => {
  sidebar_el.classList.remove("is_open");
  const ov = document.querySelector(".sidebar_overlay");
  if (ov) ov.classList.remove("is_visible");
  show_token_stats_modal();
});

// ========== Goal Memory Modal (C+) ==========

const goal_memory_modal_el = document.getElementById("goal_memory_modal");
let _gm_current_id = null;  // リンクモーダル用

async function show_goal_memory_modal() {
  goal_memory_modal_el.style.display = "flex";
  await gm_load_suggestions();
  await gm_load_list();
}

function hide_goal_memory_modal() {
  goal_memory_modal_el.style.display = "none";
}

function hide_gm_link_modal() {
  document.getElementById("gm_link_modal").style.display = "none";
}

async function gm_load_suggestions() {
  try {
    const res = await fetch("/api/goal_memory/suggestions");
    const data = await res.json();
    const banner = document.getElementById("gm_suggestion_banner");
    const list_el = document.getElementById("gm_suggestion_list");
    if (!data.suggestions || data.suggestions.length === 0) {
      banner.style.display = "none";
      return;
    }
    banner.style.display = "block";
    list_el.innerHTML = data.suggestions.map(s => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="color:#ccc;">${escape_html(s.label)}</span>
        <button onclick="gm_confirm_suggestion('${s.id}','${escape_html(s.label)}')"
          style="background:#2d5a2d;color:#8fbe8f;border:none;border-radius:4px;padding:3px 10px;font-size:0.78rem;cursor:pointer;">採用</button>
        <button onclick="gm_dismiss_suggestion('${s.id}')"
          style="background:none;color:#555;border:none;font-size:0.82rem;cursor:pointer;">✕</button>
      </div>
    `).join("");
  } catch(e) {}
}

async function gm_load_list() {
  const list_el = document.getElementById("gm_list");
  try {
    const res = await fetch("/api/goal_memory");
    const data = await res.json();
    const goals = (data.goals || []).filter(g => g.label_source !== "ai_auto");
    if (goals.length === 0) {
      list_el.innerHTML = `<div style="color:#555;font-size:0.82rem;text-align:center;padding:20px;">${t("gm_empty")}</div>`;
      return;
    }
    list_el.innerHTML = goals.map(g => `
      <div class="gm_card" id="gm_card_${g.id}">
        <div class="gm_card_header">
          <div class="gm_label">${escape_html(g.label)}</div>
          <div class="gm_card_actions">
            <button class="gm_btn" onclick="gm_show_link_modal('${g.id}','${escape_html(g.label)}')" title="${t("gm_link_thread")}">🔗</button>
            <button class="gm_btn" onclick="gm_summarize('${g.id}')" title="AI Summary">✨</button>
            <button class="gm_btn gm_btn_del" onclick="gm_delete('${g.id}')" title="${t("gm_delete")}">✕</button>
          </div>
        </div>
        ${g.ultra_summary ? `<div class="gm_ultra">${escape_html(g.ultra_summary)}</div>` : ""}
        ${g.summary ? `<div class="gm_summary">${escape_html(g.summary)}</div>` : ""}
        <div class="gm_meta">${t("gm_threads_linked").replace("{n}", g.thread_count)}</div>
      </div>
    `).join("");
  } catch(e) {
    list_el.innerHTML = `<div style="color:#e74c3c;font-size:0.82rem;text-align:center;padding:20px;">${t("gm_load_fail")}</div>`;
  }
}

async function gm_create() {
  const input = document.getElementById("gm_new_label");
  const label = input.value.trim();
  if (!label) return;
  try {
    const body = { label };
    if (chat_thread_id) body.chat_thread_id = chat_thread_id;
    await fetch("/api/goal_memory", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
    input.value = "";
    await gm_load_list();
  } catch(e) {}
}

async function gm_delete(gid) {
  if (!await show_confirm(t("confirm_gm_delete"))) return;
  await fetch(`/api/goal_memory/${gid}`, { method:"DELETE" });
  await gm_load_list();
}

async function gm_summarize(gid) {
  const btn = document.querySelector(`#gm_card_${gid} .gm_btn`);
  try {
    const res = await fetch(`/api/goal_memory/${gid}/summarize`, { method:"POST" });
    const data = await res.json();
    await gm_load_list();
  } catch(e) {}
}

async function gm_confirm_suggestion(gid, label) {
  await fetch(`/api/goal_memory/confirm_suggestion/${gid}`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ label })
  });
  await gm_load_suggestions();
  await gm_load_list();
}

async function gm_dismiss_suggestion(gid) {
  await fetch(`/api/goal_memory/${gid}`, { method:"DELETE" });
  await gm_load_suggestions();
}

async function gm_show_link_modal(gid, label) {
  _gm_current_id = gid;
  document.getElementById("gm_link_title").textContent = t("gm_link_to").replace("{label}", label);
  const body_el = document.getElementById("gm_link_body");
  body_el.innerHTML = t("gm_loading");
  document.getElementById("gm_link_modal").style.display = "flex";

  try {
    const [chat_res, linked_res] = await Promise.all([
      fetch("/api/chat_thread_list"),
      fetch(`/api/goal_memory/for_thread_all/${gid}`)
    ]);
    const chat_data = await chat_res.json();
    const linked_data = await linked_res.json();
    const linked_ids = new Set((linked_data.thread_ids || []));
    const threads = chat_data.chat_thread_list || chat_data.threads || chat_data || [];
    if (threads.length === 0) {
      body_el.innerHTML = '<div style="color:#555;padding:12px;">スレッドがありません</div>';
      return;
    }
    body_el.innerHTML = threads.map(t => {
      const tid = t.chat_thread_id || t.id;
      const title = t.title || tid.slice(0,8);
      const linked = linked_ids.has(tid);
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #222;">
          <span style="flex:1;color:${linked?'#8fbe8f':'#aaa'};font-size:0.83rem;">${escape_html(title)}</span>
          ${linked
            ? `<button onclick="gm_unlink('${tid}')" style="background:#2a1a1a;color:#e08080;border:1px solid #5a2a2a;border-radius:4px;padding:3px 10px;font-size:0.78rem;cursor:pointer;">解除</button>`
            : `<button onclick="gm_link('${tid}')" style="background:#1a2a1a;color:#8fbe8f;border:1px solid #2d5a2d;border-radius:4px;padding:3px 10px;font-size:0.78rem;cursor:pointer;">リンク</button>`
          }
        </div>`;
    }).join("");
  } catch(e) {
    body_el.innerHTML = '<div style="color:#e74c3c;">読み込みに失敗しました</div>';
  }
}

async function gm_link(thread_id) {
  if (!_gm_current_id) return;
  await fetch(`/api/goal_memory/${_gm_current_id}/link`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ chat_thread_id: thread_id })
  });
  const title_el = document.getElementById("gm_link_title");
  const label = title_el.textContent.replace("」にスレッドをリンク","").replace("「","");
  await gm_show_link_modal(_gm_current_id, label);
  await gm_load_list();
}

async function gm_unlink(thread_id) {
  if (!_gm_current_id) return;
  await fetch(`/api/goal_memory/${_gm_current_id}/link/${thread_id}`, { method:"DELETE" });
  const title_el = document.getElementById("gm_link_title");
  const label = title_el.textContent.replace("」にスレッドをリンク","").replace("「","");
  await gm_show_link_modal(_gm_current_id, label);
  await gm_load_list();
}

document.getElementById("btn_goal_memory")?.addEventListener("click", () => {
  sidebar_el.classList.remove("is_open");
  const ov = document.querySelector(".sidebar_overlay");
  if (ov) ov.classList.remove("is_visible");
  show_goal_memory_modal();
});

// ========== 会議モード ==========

// 参加者名を短縮表示（3名以上は「A, B, 他」）
function _multi_title(participants) {
  const names = (participants || []).map(p => p.actor_name || "?");
  const prefix = t("meeting_prefix");
  const beta = " β";
  if (names.length <= 2) return `${prefix}${beta}: ${names.join(", ")}`;
  return `${prefix}${beta}: ${names.slice(0, 2).join(", ")}, ${t("meeting_others").replace("{n}", names.length - 2)}`;
}

// 会議モードUI適用（テーマ・バッジ制御）
function _apply_multi_mode_ui(participants) {
  // テーマ切替: 偶数/奇数で色を変える
  const body = document.body;
  body.classList.remove("theme_none", "theme_claude", "theme_openai", "theme_gemini",
    "send_engine_claude", "send_engine_openai", "send_engine_gemini", "send_engine_openrouter");
  // テーマは温度取得後に確定（デフォルトでeven/oddを仮設定、4以上ならhotに上書き）
  const _default_theme = (participants.length % 2 === 0) ? "theme_meeting_even" : "theme_meeting_odd";
  body.classList.add(_default_theme);

  // エンジンバッジ → "MIX"
  engine_badge.textContent = "MIX";
  engine_badge.title = t("meeting_mode_label");

  // 没入度バッジ → 非表示
  immersion_badge.style.display = "none";

  // 温度・距離 → APIから実際の値を取得（会議はスレッドごとの平均温度）
  fetch(`/api/chat_thread/${chat_thread_id}/state`).then(r => r.json()).then(st => {
    if (st.uma_temperature != null) update_uma_badge(st.uma_temperature);
    else update_uma_badge(3);
    if (st.uma_distance != null) update_distance_badge(st.uma_distance);
    else update_distance_badge(0.5);
  }).catch(() => {
    update_uma_badge(3);
    update_distance_badge(0.5);
  });

  // 送信ボタンの色をリセット（会議テーマに従う）
  body.classList.remove("send_engine_claude", "send_engine_openai", "send_engine_gemini", "send_engine_openrouter");

  // マジックワードを会議用に差し替え
  _set_meeting_magic_words();
}

function _get_meeting_magic_words() {
  return [
    { label: "@",                      text: "", wrap: "mention_pick" },
    { label: "#",                      text: "", wrap: "layer_pick" },
    { label: t("mmw_continue"),       text: t("mmw_continue_text") },
    { label: t("mmw_mode_change"),   text: "", wrap: "mode_pick" },
    { label: t("mmw_reorder"),        text: t("mmw_reorder_text"), wrap: "reorder_hint" },
    { label: t("mmw_casual"),         text: t("mmw_casual_text") },
    { label: t("mmw_opposite"),       text: t("mmw_opposite_text") },
    { label: t("mmw_organize"),       text: t("mmw_organize_text") },
    { label: t("mmw_honest"),         text: t("mmw_honest_text") },
    { label: t("mmw_summarize"),      text: t("mmw_summarize_text") },
    { label: t("mmw_add_person"),     text: t("mmw_add_text"), wrap: "name_add" },
    { label: t("mmw_remove_person"),  text: t("mmw_remove_text"), wrap: "name_remove" },
  ];
}

function _set_meeting_magic_words() {
  const panel = document.getElementById("magic_words");
  if (!panel) return;
  // 元のチップを保存（復元用）
  if (!panel.dataset.original_html) {
    panel.dataset.original_html = panel.innerHTML;
  }
  const words = _get_meeting_magic_words();
  panel.innerHTML = words.map(m => {
    const wrap_attr = m.wrap ? ` data-wrap="${m.wrap}"` : "";
    return `<button class="magic_chip" data-text="${m.text}"${wrap_attr}>${m.label}</button>`;
  }).join("");
}

function _restore_magic_words() {
  const panel = document.getElementById("magic_words");
  if (!panel || !panel.dataset.original_html) return;
  panel.innerHTML = panel.dataset.original_html;
}

// 会議モードUI解除
function _clear_multi_mode_ui() {
  // マジックワード復元
  _restore_magic_words();

  const existing_bar = document.querySelector(".multi_participants_bar");
  if (existing_bar) existing_bar.remove();

  // 会議テーマを外す
  const body = document.body;
  body.classList.remove("theme_meeting_even", "theme_meeting_odd", "theme_meeting_hot");

  // 会議UI残骸を除去
  document.querySelectorAll(".free_continue_btn").forEach(el => el.remove());
  document.querySelector(".nomination_panel")?.remove();
  document.querySelectorAll(".nomination_hint").forEach(el => el.remove());
  // 挙手ポップアップがあれば閉じる
  document.getElementById("name_pick_popup")?.remove();
}

// 会議チャット作成モーダル
async function show_meeting_create_modal() {
  // アクター一覧を取得
  const res = await fetch("/api/actor");
  const data = await res.json();
  const actor_list = (data.actor || []).filter(a => !a.is_ov);
  const _avail_engines = data.available_engines || [];
  const _default_engine = data.default_engine || "claude";

  const modal = document.createElement("div");
  modal.className = "modal_overlay";
  modal.innerHTML = `
    <div class="modal_box" style="max-width:520px;">
      <div class="modal_header">
        <div class="modal_title">${t("meeting_modal_title")} <span style="font-size:0.75rem;color:#888;font-weight:normal;">${t("meeting_modal_sub")}</span></div>
        <button class="modal_close" onclick="this.closest('.modal_overlay').remove()">✕</button>
      </div>
      <div class="modal_body" id="meeting_create_body" style="max-height:60vh;overflow-y:auto;">
        <div style="margin-bottom:12px;font-size:0.82rem;color:#888;">
          ${t("meeting_modal_warn")}
        </div>
        <div id="meeting_actor_list"></div>
        <div style="margin-top:12px;">
          <label style="font-size:0.82rem;color:#aaa;">${t("meeting_conv_mode_label")}</label>
          <select id="meeting_conv_mode" style="background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:0.82rem;margin-left:6px;">
            <option value="sequential">${t("meeting_mode_sequential")}</option>
            <option value="blind">${t("meeting_mode_blind")}</option>
            <option value="free">${t("meeting_mode_free")}</option>
            <option value="nomination">${t("meeting_mode_nomination")}</option>
          </select>
        </div>
        <div style="margin-top:12px;">
          <label style="font-size:0.82rem;color:#aaa;">${t("meeting_memory_level")}</label>
          <select id="meeting_mem_level" style="background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:0.82rem;margin-left:6px;">
            <option value="0">${t("meeting_mem_lv0")}</option>
            <option value="1">${t("meeting_mem_lv1")}</option>
            <option value="2">${t("meeting_mem_lv2")}</option>
          </select>
          <div style="font-size:0.72rem;color:#666;margin-top:2px;">${t("meeting_memory_hint")}</div>
        </div>
        <div style="margin-top:12px;">
          <label style="font-size:0.82rem;color:#aaa;">${t("meeting_type_label")}</label>
          <div id="meeting_type_btns" style="display:flex;gap:6px;margin-top:4px;">
            <button type="button" class="mc_type_btn" data-type="casual" style="flex:1;padding:6px;border-radius:6px;border:1px solid #fde047;background:#fde047;color:#000;cursor:pointer;font-size:0.82rem;font-weight:600;">${t("meeting_type_casual")}<br><span style="font-size:0.62rem;font-weight:400;">${t("meeting_type_casual_desc")}</span></button>
            <button type="button" class="mc_type_btn" data-type="debate" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#aaa;cursor:pointer;font-size:0.82rem;font-weight:600;">${t("meeting_type_debate")}<br><span style="font-size:0.62rem;font-weight:400;">${t("meeting_type_debate_desc")}</span></button>
            <button type="button" class="mc_type_btn" data-type="brainstorm" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#aaa;cursor:pointer;font-size:0.82rem;font-weight:600;">${t("meeting_type_brainstorm")}<br><span style="font-size:0.62rem;font-weight:400;">${t("meeting_type_brainstorm_desc")}</span></button>
            <button type="button" class="mc_type_btn" data-type="consultation" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#aaa;cursor:pointer;font-size:0.82rem;font-weight:600;">${t("meeting_type_consultation")}<br><span style="font-size:0.62rem;font-weight:400;">${t("meeting_type_consultation_desc")}</span></button>
          </div>
        </div>
        <div style="margin-top:12px;">
          <label style="font-size:0.82rem;color:#aaa;">🌡 ${t("meeting_temp_label") || "会議の温度"}</label>
          <div id="meeting_create_temp_btns" style="display:flex;gap:6px;margin-top:4px;">
            <button type="button" class="mc_temp_btn" data-temp="3" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:var(--accent);color:#000;cursor:pointer;font-size:0.82rem;font-weight:600;">3<br><span style="font-size:0.65rem;font-weight:400;">${t("meeting_temp_3") || "通常"}</span></button>
            <button type="button" class="mc_temp_btn" data-temp="4" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#aaa;cursor:pointer;font-size:0.82rem;font-weight:600;">4<br><span style="font-size:0.65rem;font-weight:400;">${t("meeting_temp_4") || "白熱"}</span></button>
            <button type="button" class="mc_temp_btn" data-temp="4.5" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#aaa;cursor:pointer;font-size:0.82rem;font-weight:600;">4.5<br><span style="font-size:0.65rem;font-weight:400;">${t("meeting_temp_45") || "炎"}</span></button>
          </div>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:8px;">
          <label style="font-size:0.82rem;color:#aaa;display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="meeting_opening_msg" checked style="accent-color:var(--accent);">
            ${t("meeting_opening_toggle")}
          </label>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:8px;">
          <label style="font-size:0.82rem;color:#aaa;white-space:nowrap;">${t("meeting_cerebellum_engine")}</label>
          <select id="meeting_cerebellum_engine" style="background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:0.82rem;">
          </select>
        </div>
        <div style="margin-top:12px;">
          <label style="font-size:0.82rem;color:#aaa;">📋 ${t("meeting_rules_label")}</label>
          <textarea id="meeting_rules" rows="3" placeholder="${t("meeting_rules_placeholder")}" style="width:100%;margin-top:4px;background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:8px;font-size:0.82rem;resize:vertical;font-family:inherit;"></textarea>
          <div style="font-size:0.72rem;color:#666;margin-top:2px;">${t("meeting_rules_hint")}</div>
        </div>
        <div style="margin-top:16px;text-align:right;">
          <button id="meeting_create_btn" style="background:var(--accent);color:#000;border:none;border-radius:8px;padding:8px 20px;font-weight:600;cursor:pointer;font-size:0.9rem;">${t("meeting_start_btn")}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

  // セレベエンジンセレクト: 利用可能エンジンのみ表示、デフォルトに⭐
  const _cb_engine_sel = modal.querySelector("#meeting_cerebellum_engine");
  const _cb_expensive = get_lang() === "en" ? "⚠️expensive" : "⚠️高額";
  const _cb_engine_labels = { claude: `Claude (haiku) ${_cb_expensive}`, openai: "GPT (gpt-4.1-nano)", gemini: "Gemini (flash-lite)" };
  _avail_engines.forEach(eid => {
    const opt = document.createElement("option");
    opt.value = eid;
    opt.textContent = _cb_engine_labels[eid] || eid;
    if (eid === _default_engine) opt.textContent += " ⭐";
    _cb_engine_sel.appendChild(opt);
  });
  _cb_engine_sel.value = _default_engine;

  // アクターリストをチェックボックスで表示
  const list_el = modal.querySelector("#meeting_actor_list");
  const selected = new Set();

  // Personal単位でグルーピング
  const groups = {};
  actor_list.forEach(a => {
    const pid = a.personal_id;
    if (!groups[pid]) groups[pid] = [];
    groups[pid].push(a);
  });

  let color_idx = 0;
  Object.keys(groups).forEach(pid => {
    const actors = groups[pid];
    const personal_name = actors[0]?.personal_name || `Personal ${pid}`;
    actors.forEach(a => {
      const color = MULTI_COLORS[color_idx % MULTI_COLORS.length];
      color_idx++;
      const default_engine = a.personal_engine || "";
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #222;flex-wrap:wrap;";
      row.innerHTML = `
        <input type="checkbox" id="mp_${a.actor_id}" data-aid="${a.actor_id}" data-pid="${pid}" data-color="${color}" style="accent-color:${color};">
        <span style="width:18px;height:18px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#000;">${(a.name || "?")[0]}</span>
        <label for="mp_${a.actor_id}" style="font-size:0.88rem;color:#eee;cursor:pointer;flex:1;">${escape_html(a.name || "unnamed")} <span style="font-size:0.72rem;color:#666;">(${personal_name})</span></label>
        <select class="mp_engine" data-aid="${a.actor_id}" style="background:#1a1a1a;color:#aaa;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:0.72rem;">
          <option value="">Auto</option>
          ${_avail_engines.includes("claude") ? `<option value="claude" ${default_engine === "claude" ? "selected" : ""}>Claude</option>` : ""}
          ${_avail_engines.includes("openai") ? `<option value="openai" ${default_engine === "openai" ? "selected" : ""}>GPT</option>` : ""}
          ${_avail_engines.includes("gemini") ? `<option value="gemini" ${default_engine === "gemini" ? "selected" : ""}>Gemini</option>` : ""}
        </select>
        <select class="mp_model" data-aid="${a.actor_id}" style="background:#1a1a1a;color:#aaa;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:0.72rem;">
          <option value="">Default</option>
        </select>
      `;
      // エンジン変更時にモデルリストを連動更新
      const engine_sel = row.querySelector(".mp_engine");
      const model_sel = row.querySelector(".mp_model");
      const _update_model_options = async (eid) => {
        const models = await _fetch_mp_models(eid);
        model_sel.innerHTML = '<option value="">Default</option>';
        models.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m.id; opt.textContent = m.label;
          model_sel.appendChild(opt);
        });
      };
      engine_sel.addEventListener("change", () => _update_model_options(engine_sel.value));
      _update_model_options(default_engine);
      const cb = row.querySelector("input");
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(a.actor_id);
        else selected.delete(a.actor_id);
      });
      list_el.appendChild(row);
    });
  });

  // 会議タイプボタンのトグル
  let _create_type = "casual";
  const _type_colors = { casual: "#fde047", debate: "#ef4444", brainstorm: "#22c55e", consultation: "#3b82f6" };
  modal.querySelectorAll(".mc_type_btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _create_type = btn.dataset.type;
      modal.querySelectorAll(".mc_type_btn").forEach(b => {
        if (b.dataset.type === _create_type) {
          b.style.background = _type_colors[_create_type] || "var(--accent)";
          b.style.color = (_create_type === "casual" || _create_type === "brainstorm") ? "#000" : "#fff";
          b.style.borderColor = _type_colors[_create_type] || "#333";
        } else {
          b.style.background = "#1a1a1a";
          b.style.color = "#aaa";
          b.style.borderColor = "#333";
        }
      });
    });
  });

  // 温度ボタンのトグル
  let _create_temp = 3;
  modal.querySelectorAll(".mc_temp_btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _create_temp = parseFloat(btn.dataset.temp);
      modal.querySelectorAll(".mc_temp_btn").forEach(b => {
        const bv = parseFloat(b.dataset.temp);
        const is_hot = bv >= 4.5;
        if (bv === _create_temp) {
          b.style.background = is_hot ? "#ef4444" : "var(--accent)";
          b.style.color = is_hot ? "#fff" : "#000";
          b.style.borderColor = is_hot ? "#ef4444" : "#333";
        } else {
          b.style.background = "#1a1a1a";
          b.style.color = "#aaa";
          b.style.borderColor = "#333";
        }
      });
    });
  });

  // 開始ボタン
  let _creating = false;
  modal.querySelector("#meeting_create_btn").addEventListener("click", async () => {
    if (_creating) return;
    if (selected.size < 1) {
      alert(t("select_participant"));
      return;
    }
    _creating = true;
    const _btn = modal.querySelector("#meeting_create_btn");
    _btn.disabled = true;
    _btn.style.opacity = "0.7";
    let _dots = 0;
    const _dot_timer = setInterval(() => { _dots = (_dots + 1) % 4; _btn.textContent = ".".repeat(_dots || 1); }, 400);
    _btn._dot_timer = _dot_timer;

    // 参加者データを構築（エンジン＋モデル選択を含む）
    const participants = [];
    let order = 0;
    list_el.querySelectorAll("input:checked").forEach(cb => {
      const aid = parseInt(cb.dataset.aid);
      const engine_select = list_el.querySelector(`.mp_engine[data-aid="${aid}"]`);
      const model_select = list_el.querySelector(`.mp_model[data-aid="${aid}"]`);
      const engine_id = engine_select ? engine_select.value : "";
      const model_id = model_select ? model_select.value : "";
      participants.push({
        actor_id: aid,
        personal_id: parseInt(cb.dataset.pid),
        engine_id: engine_id,
        model_id: model_id,
        color: cb.dataset.color,
        role: "member",
      });
      order++;
    });

    const conv_mode = modal.querySelector("#meeting_conv_mode").value;
    const opening_msg = modal.querySelector("#meeting_opening_msg").checked;
    const mem_level = parseInt(modal.querySelector("#meeting_mem_level")?.value || "0");
    const cb_engine = modal.querySelector("#meeting_cerebellum_engine")?.value || "";
    const _rules = modal.querySelector("#meeting_rules")?.value?.trim() || "";

    try {
      const create_res = await fetch("/api/multi/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participants, conversation_mode: conv_mode, opening_message: opening_msg, meeting_lv: mem_level, meeting_type: _create_type, cerebellum_engine: cb_engine, rules: _rules, lang: get_lang() }),
      });
      const create_data = await create_res.json();

      if (create_res.ok && create_data.chat_thread_id) {
        // 会議モードに切替
        chat_thread_id = create_data.chat_thread_id;
        is_multi_mode = true;
        multi_participants = create_data.participants || [];
        multi_conv_mode = conv_mode || "sequential";
        update_url(chat_thread_id);

        // 初期温度を設定（常に全参加者に適用）
        console.log("[meeting_create] setting temperature:", _create_temp);
        try {
          await fetch("/api/multi/set_temperature", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_thread_id: chat_thread_id, temperature: _create_temp }),
          });
        } catch (e) { console.error("[meeting_create] temp set error:", e); }
        update_uma_badge(_create_temp);

        // 画面クリア & 会議開始表示
        chat_el.innerHTML = "";
        title_pill.textContent = _multi_title(multi_participants);
        const all_names = multi_participants.map(p => p.actor_name).join(", ");
        add_system_message(t("meeting_started").replace("{mode}", multi_conv_mode).replace("{names}", all_names));

        // セレベ開会メッセージ
        if (create_data.opening_message) {
          add_system_message("🧠 " + create_data.opening_message);
        }

        // 会議タイプ別ガイドメッセージ
        if (create_data.guide_message) {
          add_system_message(create_data.guide_message);
        }

        // 参加者バッジをヘッダーに表示
        _show_multi_participants_bar(multi_participants, multi_conv_mode);

        // 会議モードUI設定
        _apply_multi_mode_ui(multi_participants);

        // 入力欄のプレースホルダー
        input_el.placeholder = t("meeting_composer_ph");
        set_composer_disabled(false);

        modal.remove();
      } else {
        alert(t("meeting_create_fail") + ": " + (create_data.error || ""));
        clearInterval(_btn._dot_timer); _creating = false; _btn.disabled = false; _btn.style.opacity = "1"; _btn.textContent = t("meeting_start_btn");
      }
    } catch (e) {
      alert("Error: " + e.message);
      clearInterval(_btn._dot_timer); _creating = false; _btn.disabled = false; _btn.style.opacity = "1"; _btn.textContent = t("meeting_start_btn");
    }
  });
}

// ヘッダーに参加者バッジを表示
function _show_multi_participants_bar(participants, conv_mode) {
  // 既存バーがあれば���除
  const existing = document.querySelector(".multi_participants_bar");
  if (existing) existing.remove();

  if (!participants || participants.length === 0) return;

  const bar = document.createElement("div");
  bar.className = "multi_participants_bar";

  // モードバッジ（アイコン + テキスト + モード別色）
  if (conv_mode) {
    const mode_labels = { sequential: t("mode_sequential"), blind: t("mode_blind"), free: t("mode_free"), nomination: t("mode_nomination") };
    const mode_icons = {
      sequential: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
      blind: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
      free: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
      nomination: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
    };
    const badge = document.createElement("span");
    badge.className = `multi_mode_badge mode_${conv_mode}`;
    badge.innerHTML = `${mode_icons[conv_mode] || ""}${mode_labels[conv_mode] || conv_mode}`;
    bar.appendChild(badge);
  }

  participants.forEach(p => {
    const chip = document.createElement("span");
    chip.className = "multi_participant_chip";
    chip.style.background = p.color || "#888";
    chip.dataset.actorId = p.actor_id;
    if (p.label) {
      chip.innerHTML = `${p.actor_name || "?"}<span class="participant_label">｜${p.label}</span>`;
    } else {
      chip.textContent = p.actor_name || "?";
    }
    bar.appendChild(chip);
  });

  // ⚙ 会議設定ボタン
  const gear = document.createElement("span");
  gear.className = "multi_gear_btn";
  gear.textContent = "⚙";
  gear.title = t("cs_meeting_settings_btn") || "会議設定";
  gear.style.cssText = "cursor:pointer;font-size:14px;margin-left:4px;opacity:0.5;transition:opacity 0.2s;";
  gear.addEventListener("mouseenter", () => gear.style.opacity = "1");
  gear.addEventListener("mouseleave", () => gear.style.opacity = "0.5");
  gear.addEventListener("click", () => _show_meeting_edit_modal());
  bar.appendChild(gear);

  // ヘッダーの right_group の前に挿入
  const header = document.querySelector(".chat_header_inner");
  const right_group = header?.querySelector(".right_group");
  if (header && right_group) {
    header.insertBefore(bar, right_group);
  }

  // 挙手ボタンは非表示（フリーモードパネルに統合済み）
  const raise_btn = document.getElementById("btn_raise_hand");
  if (raise_btn) raise_btn.style.display = "none";

  // 指名パネルの表示制御
  _toggle_nomination_panel(conv_mode === "nomination" ? participants : null);

  // フリーモードコントロールパネルの表示制御
  _toggle_free_mode_panel(conv_mode === "free");
}

// ========== 指名モード: フローティングパネル ==========
let _nomination_sending = false;

function _toggle_nomination_panel(participants_or_null) {
  const existing = document.querySelector(".nomination_panel");
  if (!participants_or_null) {
    // 非表示
    if (existing) existing.remove();
    return;
  }
  // 既存があれば再構築
  if (existing) existing.remove();
  // フリーモードの「続けて」ボタンが残っていたら消す
  document.querySelectorAll(".free_continue_btn").forEach(el => el.remove());

  const panel = document.createElement("div");
  panel.className = "nomination_panel";

  const title = document.createElement("div");
  title.className = "nomination_title";
  title.textContent = t("nomination_panel_title") || "次の発言者を指名";
  panel.appendChild(title);

  const btns_wrap = document.createElement("div");
  btns_wrap.className = "nomination_btns";

  participants_or_null.forEach(p => {
    const btn = document.createElement("button");
    btn.className = "nomination_btn";
    btn.style.setProperty("--nom-color", p.color || "#888");
    btn.dataset.actorId = p.actor_id;
    btn.dataset.actorName = p.actor_name || "?";
    if (p.label) {
      btn.innerHTML = `<span class="nom_name">${p.actor_name || "?"}</span><span class="nom_label">${p.label}</span>`;
    } else {
      btn.innerHTML = `<span class="nom_name">${p.actor_name || "?"}</span>`;
    }
    btn.addEventListener("click", () => _do_nominate(p.actor_id, p.actor_name));
    btns_wrap.appendChild(btn);
  });

  panel.appendChild(btns_wrap);

  // composer_dock内、magic_wordsの直後・composerの直前に配置
  // → マジックワードが出ても消えても、指名パネルは入力欄のすぐ上に常駐
  const composer_el = document.querySelector("#composer_dock > .composer");
  const dock = document.getElementById("composer_dock");
  if (composer_el && dock) {
    dock.insertBefore(panel, composer_el);
  } else if (dock) {
    dock.appendChild(panel);
  }
}

// ========== フリーモード: コントロールパネル ==========
function _toggle_free_mode_panel(show) {
  const existing = document.querySelector(".free_mode_panel");
  if (!show) {
    if (existing) existing.remove();
    return;
  }
  if (existing) existing.remove();
  // 指名パネルが残っていたら消す
  document.querySelector(".nomination_panel")?.remove();

  const panel = document.createElement("div");
  panel.className = "free_mode_panel";

  // ✋ 挙手ボタン: 止めて「発言を待っています」を表示 → ユーザーが話したい時
  const raise_btn = document.createElement("button");
  raise_btn.className = "free_ctrl_btn free_raise_btn";
  raise_btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 6V4a2 2 0 0 0-4 0v6"/><path d="M10 10V7a2 2 0 0 0-4 0v7"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-16 0v-1"/></svg> ${t("free_raise") || "Raise hand"}`;
  raise_btn.addEventListener("click", async () => {
    await _free_mode_stop();
    _update_free_panel_state("paused");
    // 「発言を待っています」メッセージを表示
    const wait_msg = get_lang() === "en" ? "🧠 Waiting for your input." : "🧠 ユーザーの発言を待っています。";
    add_cerebellum_message(wait_msg);
  });

  // ⏸ 一時停止ボタン: 黙って止めるだけ
  const pause_btn = document.createElement("button");
  pause_btn.className = "free_ctrl_btn free_pause_btn";
  pause_btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> ${t("free_pause") || "Pause"}`;
  pause_btn.addEventListener("click", async () => {
    await _free_mode_stop();
    _update_free_panel_state("paused");
  });

  // ▶ 再開ボタン
  const resume_btn = document.createElement("button");
  resume_btn.className = "free_ctrl_btn free_resume_btn";
  resume_btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,3 19,12 5,21"/></svg> ${t("free_resume") || "Continue"}`;
  resume_btn.addEventListener("click", async () => {
    // 既存の「続けて」ボタンを削除
    document.querySelectorAll(".free_continue_btn").forEach(el => el.remove());
    _update_free_panel_state("running");
    // サーバー側のstopped状態をリセットしてからループ再開
    try {
      await fetch("/api/multi/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_thread_id: chat_thread_id, lang: get_lang() }),
      });
    } catch (e) { console.error("[FREE-RESUME]", e); }
    // フリーモード再開
    _free_mode_continue_loop(chat_thread_id);
  });

  panel.appendChild(raise_btn);
  panel.appendChild(pause_btn);
  panel.appendChild(resume_btn);

  // 初期状態
  _update_free_panel_state(_free_continue_running ? "running" : "paused", panel);

  // composer_dock内、composerの直前に配置
  const composer_el = document.querySelector("#composer_dock > .composer");
  const dock = document.getElementById("composer_dock");
  if (composer_el && dock) {
    dock.insertBefore(panel, composer_el);
  } else if (dock) {
    dock.appendChild(panel);
  }
}

function _update_free_panel_state(state, panel_el) {
  const panel = panel_el || document.querySelector(".free_mode_panel");
  if (!panel) return;
  const raise_btn = panel.querySelector(".free_raise_btn");
  const pause_btn = panel.querySelector(".free_pause_btn");
  const resume_btn = panel.querySelector(".free_resume_btn");
  if (!raise_btn || !pause_btn || !resume_btn) return;
  if (state === "running") {
    raise_btn.style.display = "";
    pause_btn.style.display = "";
    resume_btn.style.display = "none";
  } else {
    raise_btn.style.display = "none";
    pause_btn.style.display = "none";
    resume_btn.style.display = "";
  }
}

async function _do_nominate(actor_id, actor_name) {
  if (_nomination_sending || !chat_thread_id) return;
  _nomination_sending = true;

  // ボタンをアクティブ表示
  document.querySelectorAll(".nomination_btn").forEach(btn => {
    btn.classList.toggle("nom_active", parseInt(btn.dataset.actorId) === actor_id);
    btn.disabled = true;
  });

  // 指名待ちヒントがあれば消す
  document.querySelectorAll(".nomination_hint").forEach(el => el.remove());

  // 指名イベントをチャットに表示
  const nom_event = document.createElement("div");
  nom_event.className = "system_event nomination_event";
  nom_event.textContent = `🎯 ${actor_name}`;
  const wrap = document.getElementById("chat_wrap");
  if (wrap) wrap.appendChild(nom_event);
  scroll_to_bottom();

  try {
    const res = await fetch("/api/multi/nominate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_thread_id, actor_id }),
    });
    const data = await res.json();

    if (data.error) {
      add_system_message("⚠ " + data.error);
      return;
    }

    // 応答を表示
    if (data.responses) {
      for (const r of data.responses) {
        const info = _get_participant_info(r.actor_id);
        add_multi_message(r.actor_name, r.response, r.color || info.color, r.model, false, r.actor_id, r.msg_id, r.label);
      }
    }

    // 連続指名ラベル更新
    if (data.nomination && data.nomination.is_deep) {
      document.querySelectorAll(".nomination_btn").forEach(btn => {
        if (parseInt(btn.dataset.actorId) === actor_id) {
          btn.classList.add("nom_deep");
        } else {
          btn.classList.remove("nom_deep");
        }
      });
    } else {
      document.querySelectorAll(".nomination_btn").forEach(btn => btn.classList.remove("nom_deep"));
    }

    // モード変更があれば反映
    if (data.conversation_mode && data.conversation_mode !== multi_conv_mode) {
      multi_conv_mode = data.conversation_mode;
      _show_multi_participants_bar(multi_participants, multi_conv_mode);
    }

    scroll_to_bottom();

  } catch (err) {
    console.error("[NOMINATE] error:", err);
    add_system_message("⚠ 指名リクエストに失敗しました");
  } finally {
    _nomination_sending = false;
    document.querySelectorAll(".nomination_btn").forEach(btn => {
      btn.classList.remove("nom_active");
      btn.disabled = false;
    });
  }
}

function _get_participant_info(actor_id) {
  if (!multi_participants) return { name: "?", color: "#888", label: "" };
  const p = multi_participants.find(p => p.actor_id === actor_id);
  return p ? { name: p.actor_name, color: p.color, label: p.label } : { name: "?", color: "#888", label: "" };
}

// ========== 会議設定変更モーダル ==========
async function _show_meeting_edit_modal() {
  if (!is_multi_mode || !chat_thread_id) return;

  // 現在の参加者とアクター一覧とstate(温度)を取得
  const [mp_res, actor_res, st_res] = await Promise.all([
    fetch(`/api/multi/participants?chat_thread_id=${encodeURIComponent(chat_thread_id)}`),
    fetch("/api/actor"),
    fetch(`/api/chat_thread/${encodeURIComponent(chat_thread_id)}/state`),
  ]);
  const mp_data = await mp_res.json();
  const actor_data = await actor_res.json();
  const st_data = await st_res.json();
  const current_temp = st_data.uma_temperature != null ? st_data.uma_temperature : 3;
  const _is_archived = !!st_data.closed;
  const current_participants = mp_data.participants || [];
  const current_conv_mode = mp_data.conversation_mode || "sequential";
  const current_mem_lv = mp_data.meeting_lv || 0;
  const current_meeting_type = mp_data.meeting_type || "casual";
  const current_cb_engine = mp_data.cerebellum_engine || "";
  const current_rules = mp_data.meeting_rules || "";
  const actor_list = (actor_data.actor || []).filter(a => !a.is_ov);
  const _edit_avail_engines = actor_data.available_engines || [];
  const _edit_default_engine = actor_data.default_engine || "claude";

  const current_map = {};
  current_participants.forEach(p => { current_map[p.actor_id] = p; });
  const current_aids = new Set(current_participants.map(p => p.actor_id));

  // モーダル作成
  const modal = document.createElement("div");
  modal.className = "fullscreen_modal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;";
  modal.innerHTML = `
    <div style="background:#1e1e1e;border-radius:12px;max-width:500px;width:90%;padding:24px;max-height:80vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:1.1rem;font-weight:600;color:#eee;">${t("meeting_edit_title") || "⚙ 会議設定"}</div>
        <button id="meeting_edit_close" style="background:none;border:none;color:#888;font-size:1.3rem;cursor:pointer;">&times;</button>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:0.82rem;color:#aaa;">${t("meeting_conv_mode_label") || "会話モード"}</label>
        <select id="meeting_edit_mode" style="background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:0.82rem;margin-left:6px;">
          <option value="sequential" ${current_conv_mode==="sequential"?"selected":""}>${t("meeting_mode_sequential") || "順番"}</option>
          <option value="blind" ${current_conv_mode==="blind"?"selected":""}>${t("meeting_mode_blind") || "ブラインド"}</option>
          <option value="free" ${current_conv_mode==="free"?"selected":""}>${t("meeting_mode_free") || "フリー"}</option>
          <option value="nomination" ${current_conv_mode==="nomination"?"selected":""}>${t("meeting_mode_nomination") || "指名"}</option>
        </select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:0.82rem;color:#aaa;">${t("meeting_memory_level")}</label>
        <select id="meeting_edit_mem_level" style="background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:0.82rem;margin-left:6px;">
          <option value="0" ${current_mem_lv===0?"selected":""}>${t("meeting_mem_lv0")}</option>
          <option value="1" ${current_mem_lv===1?"selected":""}>${t("meeting_mem_lv1")}</option>
          <option value="2" ${current_mem_lv===2?"selected":""} ${_is_archived && current_mem_lv!==2?"disabled":""}>${t("meeting_mem_lv2")}${_is_archived && current_mem_lv!==2?" 🔒":""}
          </option>
        </select>
        <div style="font-size:0.72rem;color:#666;margin-top:2px;">${t("meeting_memory_hint")}${_is_archived?" "+( get_lang()==="en"?"(Lv2 requires reopen)":"(Lv2は再開が必要)"):""}
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:0.82rem;color:#aaa;">${t("meeting_type_label")}</label>
        <span id="meeting_edit_type_badge" style="margin-left:6px;display:inline-block;padding:2px 10px;border-radius:6px;font-size:0.82rem;font-weight:600;"></span>
      </div>
      <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
        <label style="font-size:0.82rem;color:#aaa;white-space:nowrap;">${t("meeting_cerebellum_engine")}</label>
        <select id="meeting_edit_cb_engine" style="background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:4px 8px;font-size:0.82rem;"></select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:0.82rem;color:#aaa;">📋 ${t("meeting_rules_label")}</label>
        <textarea id="meeting_edit_rules" rows="3" placeholder="${t("meeting_rules_placeholder")}" style="width:100%;margin-top:4px;background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:6px;padding:8px;font-size:0.82rem;resize:vertical;font-family:inherit;"></textarea>
        <div style="font-size:0.72rem;color:#666;margin-top:2px;">${t("meeting_rules_hint")}</div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:0.82rem;color:#aaa;">🌡 ${t("meeting_temp_label") || "会議の温度"}</label>
        <div id="meeting_temp_btns" style="display:flex;gap:6px;margin-top:4px;">
          <button class="mt_btn" data-temp="3" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:${current_temp==3?'var(--accent)':'#1a1a1a'};color:${current_temp==3?'#000':'#aaa'};cursor:pointer;font-size:0.82rem;font-weight:600;">3<br><span style="font-size:0.65rem;font-weight:400;">${t("meeting_temp_3") || "通常"}</span></button>
          <button class="mt_btn" data-temp="4" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:${current_temp==4?'var(--accent)':'#1a1a1a'};color:${current_temp==4?'#000':'#aaa'};cursor:pointer;font-size:0.82rem;font-weight:600;">4<br><span style="font-size:0.65rem;font-weight:400;">${t("meeting_temp_4") || "白熱"}</span></button>
          <button class="mt_btn" data-temp="4.5" style="flex:1;padding:6px;border-radius:6px;border:1px solid ${current_temp>=4.5?'#ef4444':'#333'};background:${current_temp>=4.5?'#ef4444':'#1a1a1a'};color:${current_temp>=4.5?'#fff':'#aaa'};cursor:pointer;font-size:0.82rem;font-weight:600;">4.5<br><span style="font-size:0.65rem;font-weight:400;">${t("meeting_temp_45") || "炎"}</span></button>
        </div>
      </div>
      <div style="font-size:0.8rem;color:#888;margin-bottom:8px;">${t("meeting_edit_check") || "参加するメンバーにチェックを入れてください。"}</div>
      <div id="meeting_edit_list" style="max-height:40vh;overflow-y:auto;"></div>
      <div style="margin-top:16px;text-align:right;">
        <button id="meeting_edit_apply" style="background:var(--accent);color:#000;border:none;border-radius:8px;padding:8px 20px;font-weight:600;cursor:pointer;font-size:0.9rem;">${t("meeting_edit_apply") || "変更を適用"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // 閉じるボタン
  modal.querySelector("#meeting_edit_close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  // 会議ルール初期値
  const _rules_ta = modal.querySelector("#meeting_edit_rules");
  if (_rules_ta && current_rules) _rules_ta.value = current_rules;

  // 会議タイプバッジ（表示のみ）
  const _mt_badge = modal.querySelector("#meeting_edit_type_badge");
  const _mt_colors = { casual: "#fde047", debate: "#ef4444", brainstorm: "#22c55e", consultation: "#3b82f6" };
  const _mt_labels = { casual: t("meeting_type_casual"), debate: t("meeting_type_debate"), brainstorm: t("meeting_type_brainstorm"), consultation: t("meeting_type_consultation") };
  _mt_badge.textContent = _mt_labels[current_meeting_type] || current_meeting_type;
  _mt_badge.style.background = _mt_colors[current_meeting_type] || "#555";
  _mt_badge.style.color = (current_meeting_type === "casual" || current_meeting_type === "brainstorm") ? "#000" : "#fff";

  // セレベエンジンセレクト
  const _edit_cb_sel = modal.querySelector("#meeting_edit_cb_engine");
  const _edit_cb_expensive = get_lang() === "en" ? "⚠️expensive" : "⚠️高額";
  const _edit_cb_labels = { claude: `Claude (haiku) ${_edit_cb_expensive}`, openai: "GPT (gpt-4.1-nano)", gemini: "Gemini (flash-lite)" };
  _edit_avail_engines.forEach(eid => {
    const opt = document.createElement("option");
    opt.value = eid;
    opt.textContent = _edit_cb_labels[eid] || eid;
    if (eid === _edit_default_engine) opt.textContent += " ⭐";
    _edit_cb_sel.appendChild(opt);
  });
  _edit_cb_sel.value = current_cb_engine || _edit_default_engine;

  // 温度ボタンのトグル
  let _selected_temp = current_temp;
  modal.querySelectorAll(".mt_btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _selected_temp = parseFloat(btn.dataset.temp);
      modal.querySelectorAll(".mt_btn").forEach(b => {
        const bv = parseFloat(b.dataset.temp);
        const is_hot = bv >= 4.5;
        if (bv === _selected_temp) {
          b.style.background = is_hot ? "#ef4444" : "var(--accent)";
          b.style.color = is_hot ? "#fff" : "#000";
          b.style.borderColor = is_hot ? "#ef4444" : "#333";
        } else {
          b.style.background = "#1a1a1a";
          b.style.color = "#aaa";
          b.style.borderColor = "#333";
        }
      });
    });
  });

  // アクターリスト描画
  const list_el = modal.querySelector("#meeting_edit_list");
  const _colors = MULTI_COLORS;
  const grouped = {};
  actor_list.forEach(a => {
    const pid = a.personal_id || 1;
    if (!grouped[pid]) grouped[pid] = [];
    grouped[pid].push(a);
  });

  // ── ①参加中セクション（フラット表示）──
  if (current_aids.size > 0) {
    const sep = document.createElement("div");
    sep.style.cssText = "font-size:0.72rem;color:#888;margin:4px 0 4px;padding-bottom:4px;border-bottom:1px solid #444;font-weight:600;";
    sep.textContent = get_lang() === "en" ? "▶ Participating" : "▶ 参加中";
    list_el.appendChild(sep);
  }

  let ci = 0;
  const _render_row = (a, pid, is_current, hidden) => {
    const cp = current_map[a.actor_id];
    const color = cp?.color || _colors[ci % _colors.length];
    const cur_eid = cp?.engine_id || a.personal_engine || "";
    const cur_mid = cp?.model_id || "";
    const row = document.createElement("div");
    row.style.cssText = `display:${hidden ? "none" : "flex"};align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #222;flex-wrap:wrap;`;
    row.dataset.aid = String(a.actor_id);
    row.innerHTML = `
      <input type="checkbox" ${is_current?"checked":""} data-aid="${a.actor_id}" data-pid="${pid}" data-color="${color}" style="accent-color:${color};">
      <span style="width:16px;height:16px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#000;">${(a.name||"?")[0]}</span>
      <span style="font-size:0.85rem;color:#eee;flex:1;">${escape_html(a.name || "?")}</span>
      <select class="me_engine" data-aid="${a.actor_id}" style="background:#1a1a1a;color:#aaa;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:0.72rem;">
        <option value="">Auto</option>
        ${_edit_avail_engines.includes("claude") ? `<option value="claude" ${cur_eid==="claude"?"selected":""}>Claude</option>` : ""}
        ${_edit_avail_engines.includes("openai") ? `<option value="openai" ${cur_eid==="openai"?"selected":""}>GPT</option>` : ""}
        ${_edit_avail_engines.includes("gemini") ? `<option value="gemini" ${cur_eid==="gemini"?"selected":""}>Gemini</option>` : ""}
      </select>
      <select class="me_model" data-aid="${a.actor_id}" style="background:#1a1a1a;color:#aaa;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:0.72rem;">
        <option value="">Default</option>
      </select>
    `;
    const eng_sel = row.querySelector(".me_engine");
    const mod_sel = row.querySelector(".me_model");
    const _upd_models = async (eid) => {
      const models = await _fetch_mp_models(eid);
      mod_sel.innerHTML = '<option value="">Default</option>';
      models.forEach(m => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; mod_sel.appendChild(o); });
    };
    eng_sel.addEventListener("change", () => _upd_models(eng_sel.value));
    _upd_models(cur_eid).then(() => { if (cur_mid) mod_sel.value = cur_mid; });
    list_el.appendChild(row);
    ci++;
  };

  // 参加中メンバーをフラット表示
  current_participants.forEach(p => {
    const a = actor_list.find(x => x.actor_id === p.actor_id);
    if (a) _render_row(a, String(a.personal_id || 1), true, false);
  });

  // ── ②元のPersonalグループリスト（参加中はスキップ）──
  const _has_others = actor_list.some(a => !current_aids.has(a.actor_id));
  if (_has_others) {
    const sep2 = document.createElement("div");
    sep2.style.cssText = "font-size:0.72rem;color:#555;margin:10px 0 4px;padding-bottom:4px;border-bottom:1px solid #333;";
    sep2.textContent = get_lang() === "en" ? "── Others" : "── その他";
    list_el.appendChild(sep2);
  }
  Object.keys(grouped).forEach(pid => {
    const actors = grouped[pid];
    const non_current = actors.filter(a => !current_aids.has(a.actor_id));
    if (non_current.length === 0) return; // 全員参加中ならスキップ
    const pname = actors[0]?.personal_name || `Personal ${pid}`;
    const sec_hdr = document.createElement("div");
    sec_hdr.style.cssText = "font-size:0.72rem;color:#555;margin:8px 0 4px;";
    sec_hdr.textContent = pname;
    list_el.appendChild(sec_hdr);

    non_current.forEach(a => {
      _render_row(a, pid, false, false);
    });
  });

  // 適用ボタン
  modal.querySelector("#meeting_edit_apply").addEventListener("click", async () => {
    const checks = list_el.querySelectorAll("input[type=checkbox]:checked");
    if (checks.length < 1) {
      alert(t("select_participant") || "参加者を選択してください");
      return;
    }

    const participants = [];
    checks.forEach(cb => {
      const aid = parseInt(cb.dataset.aid);
      const eng = list_el.querySelector(`.me_engine[data-aid="${aid}"]`);
      const mod = list_el.querySelector(`.me_model[data-aid="${aid}"]`);
      participants.push({
        actor_id: aid,
        personal_id: parseInt(cb.dataset.pid),
        engine_id: eng ? eng.value : "",
        model_id: mod ? mod.value : "",
        color: cb.dataset.color,
        role: "member",
      });
    });

    const new_conv_mode = modal.querySelector("#meeting_edit_mode").value;
    const new_mem_level = parseInt(modal.querySelector("#meeting_edit_mem_level")?.value || "0");
    const new_cb_engine = modal.querySelector("#meeting_edit_cb_engine")?.value || "";
    const new_rules = modal.querySelector("#meeting_edit_rules")?.value?.trim() ?? null;

    // 温度変更があればサーバーに反映
    if (_selected_temp !== current_temp) {
      try {
        await fetch("/api/multi/set_temperature", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_thread_id: chat_thread_id, temperature: _selected_temp }),
        });
      } catch (e) { console.error("[meeting_edit] temp update error:", e); }
    }
    // テーマカラーを常に即時反映（温度未変更でもtheme適用を保証）
    update_uma_badge(_selected_temp);

    try {
      const res = await fetch("/api/multi/update_participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_thread_id: chat_thread_id,
          participants: participants,
          conversation_mode: new_conv_mode,
          meeting_lv: new_mem_level,
          cerebellum_engine: new_cb_engine,
          rules: new_rules,
          lang: get_lang(),
        }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        // アナウンスを表示
        console.log("[meeting_edit] announcements:", data.announcements);
        if (data.announcements && data.announcements.length > 0) {
          data.announcements.forEach(msg => add_cerebellum_message(msg));
        }

        // 参加者リストを更新
        multi_participants = data.participants || [];
        multi_conv_mode = data.conversation_mode || multi_conv_mode;
        title_pill.textContent = _multi_title(multi_participants);
        _show_multi_participants_bar(multi_participants, multi_conv_mode);

        modal.remove();
      } else {
        alert(data.error || "更新に失敗しました");
      }
    } catch (e) {
      console.error("meeting edit error:", e);
      alert("通信エラー: " + e.message);
    }
  });
}


// 会議モード用メッセージ追加
function add_multi_message(actor_name, text, color, model_name, is_blind, actor_id, msg_id, label) {
  const div = document.createElement("div");
  div.classList.add("msg", "msg_ai", "msg_multi");
  if (actor_id) div.dataset.actor_id = actor_id;
  if (msg_id) div.dataset.msg_id = msg_id;

  // アバター（頭文字 + 色）
  const avatar = document.createElement("div");
  avatar.className = "msg_multi_avatar";
  avatar.style.background = color || "#888";
  avatar.textContent = (actor_name || "?")[0];
  div.appendChild(avatar);

  // 発言者名
  const speaker = document.createElement("div");
  speaker.className = "msg_multi_speaker";
  speaker.style.color = color || "#888";
  if (msg_id && (current_dev_flag >= 1 || imitation_dev_mode)) speaker.title = `#${msg_id}`;
  // ブラインドアイコン（目に斜線 SVG）
  if (is_blind) {
    const blind_label = t("blind_mode_label");
    speaker.innerHTML = `<span class="blind_icon_wrap" style="position:relative;cursor:pointer;"><svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px;margin-right:3px;opacity:0.7;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>${blind_label}</title><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></span>${actor_name}`;
    speaker.querySelector(".blind_icon_wrap").addEventListener("click", (e) => {
      e.stopPropagation();
      const wrap = e.currentTarget;
      if (wrap.querySelector(".blind_tooltip")) return;
      const tip = document.createElement("span");
      tip.className = "blind_tooltip";
      tip.textContent = blind_label;
      tip.style.cssText = "position:absolute;left:50%;top:-28px;transform:translateX(-50%);background:#333;color:#f0a500;padding:2px 8px;border-radius:4px;font-size:0.75rem;white-space:nowrap;z-index:10;pointer-events:none;";
      wrap.appendChild(tip);
      setTimeout(() => tip.remove(), 1500);
    });
  } else {
    speaker.textContent = actor_name;
  }
  // ラベル表示（立場・役割）
  if (label) {
    const lbl = document.createElement("span");
    lbl.className = "msg_multi_label";
    lbl.textContent = `｜${label}`;
    speaker.appendChild(lbl);
  }
  div.appendChild(speaker);

  // エラー応答チェック
  const is_error = text.startsWith("[エラー:") || text.startsWith("[Error:");
  const body = document.createElement("div");
  body.classList.add("msg_body");

  if (is_error) {
    // エラーメッセージをフレンドリーに変換
    const raw = text.replace(/^\[エラー:\s*/, "").replace(/^\[Error:\s*/, "").replace(/\]$/, "");
    const friendly = translate_error(raw, 0);
    body.innerHTML = `<span style="opacity:0.8;">${friendly}</span>`;
    div.appendChild(body);

    // 再生成ボタン
    const retry_btn = document.createElement("button");
    retry_btn.className = "msg_action_btn";
    retry_btn.title = t("regenerate");
    retry_btn.style.cssText = "margin:4px 0 0 42px;padding:4px 10px;background:#333;border:1px solid #555;border-radius:6px;color:#ccc;cursor:pointer;font-size:0.75rem;display:inline-flex;align-items:center;gap:4px;";
    retry_btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>${t("regenerate")}`;
    retry_btn.addEventListener("click", async () => {
      if (actor_id && chat_thread_id) {
        // 会議モード: この1人だけ再生成
        retry_btn.disabled = true;
        retry_btn.textContent = "⏳...";
        try {
          const res = await fetch("/api/multi/regenerate_one", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({chat_thread_id, actor_id: Number(actor_id), msg_id: Number(msg_id || 0)}),
          });
          const result = await res.json();
          if (res.ok && result.response) {
            div.remove();
            add_multi_message(
              result.response.actor_name, result.response.response,
              result.response.color, result.response.model, false,
              result.response.actor_id, null, result.response.label
            );
          } else {
            retry_btn.disabled = false;
            retry_btn.textContent = `❌ ${result.error || "Error"}`;
            setTimeout(() => { retry_btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>${t("regenerate")}`; retry_btn.disabled = false; }, 3000);
          }
        } catch (e) {
          retry_btn.disabled = false;
          retry_btn.textContent = "❌ " + e.message;
        }
      } else {
        // 通常モード: 全部やり直し
        div.remove();
        const user_msgs = chat_el.querySelectorAll(".msg_user .msg_body");
        const last_text = user_msgs.length ? user_msgs[user_msgs.length - 1].textContent.trim() : "";
        if (last_text) {
          input_el.value = last_text;
          input_el.focus();
        }
      }
    });
    div.appendChild(retry_btn);
  } else {
    body.innerHTML = render_text(text);
    div.appendChild(body);
  }

  // アクションバー（コピー + リジェネ）— エラーでないメッセージに表示
  if (!is_error) {
    const bar = document.createElement("div");
    bar.classList.add("msg_action_bar");

    // コピーボタン
    const copy_svg = `<svg viewBox="0 0 24 24" class="msg_action_icon"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const btn_copy = document.createElement("button");
    btn_copy.className = "msg_action_btn";
    btn_copy.title = t("copy");
    btn_copy.innerHTML = copy_svg;
    btn_copy.addEventListener("click", () => {
      navigator.clipboard.writeText(text).then(() => {
        btn_copy.innerHTML = `<svg viewBox="0 0 24 24" class="msg_action_icon"><polyline points="20 6 9 17 4 12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        setTimeout(() => { btn_copy.innerHTML = copy_svg; }, 1500);
      });
    });
    bar.appendChild(btn_copy);

    // リジェネボタン（会議モード: 1人分 or 以降全部）
    if (actor_id && chat_thread_id) {
      const regen_svg = `<svg viewBox="0 0 24 24" class="msg_action_icon"><polyline points="1 4 1 10 7 10" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="23 20 23 14 17 14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const btn_regen = document.createElement("button");
      btn_regen.className = "msg_action_btn";
      btn_regen.title = t("regenerate");
      btn_regen.innerHTML = regen_svg;
      btn_regen.addEventListener("click", async () => {
        // 選択肢: この1人だけ or この発言以降全部
        const has_after = has_messages_after(div, false);
        let choice = "one"; // デフォルトは単体
        if (has_after) {
          choice = await _show_regen_choice();
          if (!choice) return; // キャンセル
        }
        if (choice === "all") {
          // この発言以降を全部やり直し（従来のretry）
          retry_message(div, null);
        } else {
          // この1人だけ再生成
          btn_regen.innerHTML = "⏳";
          btn_regen.disabled = true;
          try {
            const res = await fetch("/api/multi/regenerate_one", {
              method: "POST",
              headers: {"Content-Type": "application/json"},
              body: JSON.stringify({chat_thread_id, actor_id: Number(actor_id), msg_id: Number(msg_id || 0)}),
            });
            const result = await res.json();
            if (res.ok && result.response) {
              // メッセージを差し替え
              const new_el = add_multi_message(
                result.response.actor_name, result.response.response,
                result.response.color, result.response.model, false,
                result.response.actor_id, result.response.msg_id, result.response.label
              );
              div.replaceWith(new_el);
            } else {
              btn_regen.innerHTML = regen_svg;
              btn_regen.disabled = false;
              alert(result.error || "Regeneration failed");
            }
          } catch (e) {
            btn_regen.innerHTML = regen_svg;
            btn_regen.disabled = false;
            alert(e.message);
          }
        }
      });
      bar.appendChild(btn_regen);
    }

    div.appendChild(bar);
  }

  // モデル名
  if (model_name && !is_error) {
    const label = document.createElement("div");
    label.className = "msg_model_label";
    label.textContent = _shorten_model(model_name);
    div.appendChild(label);
  }

  chat_el.appendChild(div);
  scroll_to_bottom();
  return div;
}

// セレベ（フ��シリテーター）メッセージ表���
function add_cerebellum_message(text, raw_html = false) {
  const div = document.createElement("div");
  div.classList.add("msg", "msg_cerebellum");

  const body = document.createElement("div");
  body.classList.add("msg_cerebellum_body");
  if (raw_html) {
    body.innerHTML = text;
  } else {
    body.textContent = text;
  }
  div.appendChild(body);

  chat_el.appendChild(div);
  scroll_to_bottom();
  return div;
}

// --- フリーモード応答描画ヘルパー ---
// 戻り値: true=エラーあり（自動進行停止すべき）
function _render_multi_responses(data) {
  let has_error = false;
  for (const r of (data.responses || [])) {
    if (r.response && r.response.trim()) {
      const is_err = r.response.startsWith("[エラー:") || r.response.startsWith("[Error:") || r.model === "error";
      if (is_err) has_error = true;
      add_multi_message(r.actor_name, r.response, r.color, r.model, r.blind, r.actor_id, r.msg_id, r.label);
    }
    // 会議中のside_effects（経験持ち帰り通知など）
    if (r.side_effects) {
      for (const se of r.side_effects) {
        if (se.type === "experience_saved") {
          add_system_message(`📝 ${se.actor_name} ${t("experience_saved").replace("{name}", se.abstract)}`);
        }
      }
    }
  }
  if (has_error) _free_continue_running = false;
  // セレベ介入メッセージ
  if (data.cerebellum && data.cerebellum.message) {
    add_cerebellum_message(data.cerebellum.message);
  }
  // ラベル更新（セレベが検知した立場・役割）
  if (data.label_updates && typeof data.label_updates === "object") {
    for (const [aid, lbl] of Object.entries(data.label_updates)) {
      const p = multi_participants.find(pp => pp.actor_id == aid);
      if (p) p.label = lbl;
    }
    _show_multi_participants_bar(multi_participants, multi_conv_mode);
  }
  // モード切替バッジ更新
  if (data.conversation_mode && data.conversation_mode !== multi_conv_mode) {
    multi_conv_mode = data.conversation_mode;
    _show_multi_participants_bar(multi_participants, multi_conv_mode);
  }
  // トークンログ
  const tu = data.token_usage;
  if (tu) {
    console.log("[MULTI]", t("meeting_tokens").replace("{inp}", tu.total_input).replace("{out}", tu.total_output));
  }
}

// フリーモード自動停止フラグ（挙手等で外からstopする用）
let _free_continue_running = false;

async function _free_mode_stop() {
  _free_continue_running = false;
  try {
    await fetch("/api/multi/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_thread_id: chat_thread_id }),
    });
  } catch (e) {}
}

async function _free_mode_continue_loop(thread_id) {
  _free_continue_running = true;
  _update_free_panel_state("running");

  while (_free_continue_running) {
    // thinking表示
    const th = add_thinking();
    const st = start_status_polling(thread_id, th);

    try {
      const res = await fetch("/api/multi/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_thread_id: thread_id, lang: get_lang() }),
      });
      const data = await res.json();

      stop_status_polling(st);
      remove_thinking(th);

      if (!res.ok || !data.responses || data.responses.length === 0) {
        // 停止 or エラー
        if (data.cerebellum && data.cerebellum.message) {
          add_cerebellum_message(data.cerebellum.message);
        }
        // モード切替対応
        if (data.conversation_mode && data.conversation_mode !== multi_conv_mode) {
          multi_conv_mode = data.conversation_mode;
          _show_multi_participants_bar(multi_participants, multi_conv_mode);
        }
        break;
      }

      _render_multi_responses(data);

      // UMAバッジ更新（会議の平均温度）
      if (data.uma_temperature != null) update_uma_badge(data.uma_temperature);

      if (!data.free_continue) {
        break;
      }
    } catch (e) {
      stop_status_polling(st);
      remove_thinking(th);
      console.error("[FREE-CONTINUE]", e);
      break;
    }
  }

  _free_continue_running = false;
  // フリーモード停止後にパネルをpaused状態に更新
  _update_free_panel_state("paused");
}

// 会議チャットボタン
document.getElementById("btn_new_meeting")?.addEventListener("click", () => {
  _dismiss_meeting_unlock_notify();
  toggle_sidebar();
  show_meeting_create_modal();
});

// 会議ボタン表示条件チェック: 人格2人以上 AND アクター1人以上（OV除く）
async function _check_meeting_button_visibility() {
  try {
    const res = await fetch("/api/actor");
    const data = await res.json();
    const actors = (data.actor || []).filter(a => !a.is_ov);
    const btn = document.getElementById("btn_new_meeting");
    if (!btn) return;
    // 人格数をカウント（ユニークなpersonal_id）
    const personal_ids = new Set(actors.map(a => a.personal_id));
    const unlocked = personal_ids.size >= 2 && actors.length >= 1;
    if (unlocked) {
      btn.style.display = "";
      // 初回解放通知（まだ見ていなければ）
      if (!localStorage.getItem("meeting_unlocked_seen") && !document.querySelector(".meeting_unlock_bubble")) {
        _show_meeting_unlock_notify();
      }
    } else {
      btn.style.display = "none";
    }
  } catch (e) {}
}

// 会議チャット解放通知
function _show_meeting_unlock_notify() {
  // 既に表示中なら何もしない
  if (document.querySelector(".meeting_unlock_bubble")) return;

  const _unlock_text = t("meeting_unlocked") || "会議チャット解放！";

  // 1) サイドバートグルボタンの横（サイドバー閉じている時用）
  const b1 = document.createElement("div");
  b1.className = "meeting_unlock_bubble meeting_unlock_outer";
  b1.textContent = _unlock_text;
  document.body.appendChild(b1);

  // 2) 会議チャットボタンの右（サイドバー開いた時用）— 短縮テキスト
  const meeting_btn = document.getElementById("btn_new_meeting");
  if (meeting_btn) {
    const b2 = document.createElement("div");
    b2.className = "meeting_unlock_bubble meeting_unlock_inner";
    b2.textContent = t("meeting_unlocked_short") || "解放！";
    meeting_btn.appendChild(b2);
  }
}

// 通知消去（手動呼び出し用）
function _dismiss_meeting_unlock_notify() {
  document.querySelectorAll(".meeting_unlock_bubble").forEach(el => el.remove());
  localStorage.setItem("meeting_unlocked_seen", "1");
}

// ========== メモ帳 ==========

async function show_memos_modal() {
  const modal = document.createElement("div");
  modal.className = "modal_overlay";
  modal.innerHTML = `
    <div class="modal_box" style="max-width:600px;">
      <div class="modal_header">
        <div class="modal_title">${t("memo_title")} <span style="font-size:0.75rem;color:#888;font-weight:normal;">${t("memo_subtitle")}</span></div>
        <button class="modal_close" onclick="this.closest('.modal_overlay').remove()">✕</button>
      </div>
      <div class="modal_body" id="memos_modal_body" style="max-height:60vh;overflow-y:auto;">
        <div style="text-align:center;color:#555;padding:24px 0;font-size:0.82rem;">${t("memo_loading")}</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

  const body = modal.querySelector("#memos_modal_body");
  try {
    const res = await fetch(`/api/memos?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
    const data = await res.json();

    if (!data.memos || data.memos.length === 0) {
      body.innerHTML = `<div style="text-align:center;color:#555;padding:24px 0;font-size:0.82rem;">${t("memo_empty")}</div>`;
      return;
    }

    let html = "";
    for (const m of data.memos) {
      const date = (m.created_at || "").slice(0, 16).replace("T", " ");
      const status_badge = m.status === "done"
        ? `<span style="color:#10b981;font-size:0.7rem;margin-left:6px;">✓ ${t("memo_done")}</span>`
        : `<span style="color:#f59e0b;font-size:0.7rem;margin-left:6px;">📝 ${t("memo_pending")}</span>`;
      const type_label = m.memo_type && m.memo_type !== "memo" ? `[${m.memo_type}] ` : "";
      html += `
        <div style="border-bottom:1px solid var(--border);padding:10px 0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:0.72rem;color:#888;">${date}</span>
            ${status_badge}
            <span style="font-size:0.7rem;color:#666;">${type_label}ID:${m.id}</span>
          </div>
          <div style="font-size:0.85rem;color:var(--text);white-space:pre-wrap;line-height:1.5;">${escape_html(m.content || "")}</div>
        </div>
      `;
    }
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div style="color:#e74c3c;padding:16px;font-size:0.82rem;">${t("memo_error")}: ${e.message}</div>`;
  }
}

document.getElementById("btn_memos")?.addEventListener("click", () => {
  sidebar_el.classList.remove("is_open");
  const ov = document.querySelector(".sidebar_overlay");
  if (ov) ov.classList.remove("is_visible");
  show_memos_modal();
});

// ========== 小脳ダッシュボード ==========

async function show_cerebellum_modal() {
  const modal = document.createElement("div");
  modal.className = "modal_overlay";
  modal.innerHTML = `
    <div class="modal_box" style="max-width:700px;">
      <div class="modal_header">
        <div class="modal_title">小脳ダッシュボード</div>
        <button class="modal_close" onclick="this.closest('.modal_overlay').remove()">✕</button>
      </div>
      <div class="modal_body" id="cb_modal_body">
        <div style="text-align:center;color:#555;padding:24px 0;font-size:0.82rem;">読み込み中...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

  const body = modal.querySelector("#cb_modal_body");
  try {
    const res = await fetch("/api/cerebellum/stats");
    const data = await res.json();

    if (data.total === 0) {
      body.innerHTML = '<div style="text-align:center;color:#555;padding:24px 0;font-size:0.82rem;">ログがまだありません</div>';
      return;
    }

    const match_color = data.match_rate >= 80 ? "good" : data.match_rate >= 60 ? "warn" : "";
    const adopt_color = data.cb_adoption_rate >= 80 ? "good" : data.cb_adoption_rate >= 60 ? "warn" : "";

    let rows = "";
    for (const log of data.logs) {
      const match_badge = log.match
        ? '<span class="cb_badge match">一致</span>'
        : '<span class="cb_badge diff">差異</span>';
      const by_badge = log.used_by === "cerebellum"
        ? '<span class="cb_badge cb">小脳</span>'
        : log.used_by === "keyword"
        ? '<span class="cb_badge kw">KW</span>'
        : '<span class="cb_badge kw">—</span>';
      const preview = (log.message_preview || "").slice(0, 30);
      const ms = log.cerebellum_ms ? `${Math.round(log.cerebellum_ms)}ms` : "—";
      rows += `<tr>
        <td style="color:#666;font-size:0.68rem;">${(log.created_at||"").slice(5,16)}</td>
        <td>${preview}</td>
        <td>${log.keyword_tools}/${log.keyword_recall}</td>
        <td>${log.cerebellum_tools || "—"}/${log.cerebellum_recall || "—"}</td>
        <td>${log.used_tools || "—"}/${log.used_recall || "—"} ${by_badge}</td>
        <td>${match_badge}</td>
        <td style="color:#555;">${ms}</td>
      </tr>`;
    }

    body.innerHTML = `
      <div class="cb_stats_row">
        <div class="cb_stat_card">
          <div class="cb_stat_label">判定件数</div>
          <div class="cb_stat_value">${data.total}</div>
        </div>
        <div class="cb_stat_card">
          <div class="cb_stat_label">KW一致率</div>
          <div class="cb_stat_value ${match_color}">${data.match_rate ?? "—"}%</div>
        </div>
        <div class="cb_stat_card">
          <div class="cb_stat_label">小脳採用率</div>
          <div class="cb_stat_value ${adopt_color}">${data.cb_adoption_rate ?? "—"}%</div>
        </div>
        <div class="cb_stat_card">
          <div class="cb_stat_label">平均応答</div>
          <div class="cb_stat_value">${data.avg_ms ?? "—"}ms</div>
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table class="cb_log_table">
          <thead><tr>
            <th>日時</th><th>メッセージ</th><th>KW判定</th><th>小脳判定</th><th>実際に使用</th><th>一致</th><th>応答</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch (e) {
    body.innerHTML = '<div style="color:#e74c3c;font-size:0.82rem;text-align:center;padding:24px 0;">読み込みに失敗しました</div>';
  }
}

document.getElementById("btn_cerebellum")?.addEventListener("click", () => {
  sidebar_el.classList.remove("is_open");
  const ov = document.querySelector(".sidebar_overlay");
  if (ov) ov.classList.remove("is_visible");
  show_cerebellum_modal();
});

// ========== Global Error Handler ==========
window.addEventListener("error", (e) => {
  console.error("Global error:", e.message, e.filename, e.lineno);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason);
  // 白画面になった場合のフォールバック
  if (chat_el && chat_el.children.length === 0) {
    add_system_message(t("page_reload_error"));
  }
});

// ========== ③ Welcome Message ==========
function show_welcome_message() {
  const el = document.createElement("div");
  el.className = "welcome_message";
  el.innerHTML = `
    <div class="welcome_title">${t("welcome_title")}</div>
    <div>${t("welcome_sub1")}</div>
    <div class="welcome_sub" style="margin-top:16px;">${t("welcome_sub2")}</div>
  `;
  chat_el.appendChild(el);
}

// ========== Model Name Shortener ==========
function _shorten_model(name) {
  if (!name) return "?";
  // Claude models
  if (name.includes("haiku")) return "Haiku";
  if (name.includes("opus")) return "Opus";
  if (name.includes("sonnet")) return "Sonnet";
  // OpenAI models
  if (name.includes("gpt-4.1-nano")) return "4.1 nano";
  if (name.includes("gpt-4.1-mini")) return "4.1 mini";
  if (name.includes("gpt-4.1")) return "GPT-4.1";
  if (name.includes("gpt-4o-mini")) return "4o mini";
  if (name.includes("gpt-4o")) return "GPT-4o";
  return name;
}

// ========== ② Cerebellum Toast ==========
function show_cerebellum_toast(model_name, cb_ms) {
  const toast = document.getElementById("cerebellum_toast");
  if (!toast) return;
  const label = _shorten_model(model_name);
  const is_gpt = model_name.includes("gpt");
  const prefix = is_gpt ? "🧠 GPT" : "🧠 セレベ";
  const ms_text = cb_ms ? ` (${cb_ms}ms)` : "";
  toast.textContent = `${prefix} → ${label}${ms_text}`;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 2500);
}

// ========== ① Memory Layer Panel (collapsible) ==========
let _mlp_current_slide = 0;

function _mlp_build_slide(sub_title, stats, bar_color) {
  const layers = [
    { key: "traits", label: t("trait") },
    { key: "experience", label: t("experience") },
    { key: "long_term", label: t("long_term") },
    { key: "dictionary", label: t("dictionary") },
    { key: "middle_term", label: t("middle_term") },
    { key: "short_term", label: t("short_term") },
  ];
  const max_val = Math.max(...layers.map(l => stats[l.key] || 0), 1);
  const pct = v => Math.min(100, Math.round((v / max_val) * 100));
  const slide = document.createElement("div");
  slide.classList.add("mlp_slide");
  let html = sub_title ? `<div class="mlp_title" style="color:${bar_color}">${sub_title}</div>` : "";
  layers.forEach(l => {
    const v = stats[l.key] || 0;
    html += `<div class="memory_layer_row">
      <span class="mlr_label">${l.label}</span>
      <div class="mlr_bar_wrap"><div class="mlr_bar" style="width:${pct(v)}%;background:${bar_color}"></div></div>
      <span class="mlr_count">${v}</span>
    </div>`;
  });
  slide.innerHTML = html;
  return slide;
}

async function update_memory_layer_panel() {
  const panel = document.getElementById("memory_layer_panel");
  if (!panel) return;
  try {
    const res = await fetch(`/api/memory/stats?chat_thread_id=${encodeURIComponent(chat_thread_id)}`);
    const data = await res.json();
    const slider = document.getElementById("mlp_slider");
    const dots_el = document.getElementById("mlp_dots");
    if (!slider) return;

    const engine_colors = { claude: "#e8a756", openai: "#00d26a", gemini: "#8b5cf6" };
    const _current_eng = document.body.classList.contains("send_engine_openai") ? "openai"
      : document.body.classList.contains("send_engine_gemini") ? "gemini" : "claude";
    const accent = engine_colors[_current_eng] || engine_colors.claude;

    // スライド構築
    const slides = [];
    // 全体スライド
    slides.push(_mlp_build_slide("MEMORY", data.total || data, accent));
    // 各Personalスライド
    const personals = data.personals || [];
    personals.forEach(p => {
      const color = engine_colors[p.engine || "claude"] || engine_colors.claude;
      slides.push(_mlp_build_slide(p.name || "Personal", p.stats, color));
    });

    slider.innerHTML = "";
    slides.forEach(s => slider.appendChild(s));

    // ドットインジケーター（スライド2枚以上の時のみ）
    if (dots_el) {
      dots_el.innerHTML = "";
      if (slides.length > 1) {
        slides.forEach((_, i) => {
          const dot = document.createElement("span");
          dot.classList.add("mlp_dot");
          if (i === _mlp_current_slide) dot.classList.add("active");
          dot.addEventListener("click", () => _mlp_go_to(i));
          dots_el.appendChild(dot);
        });
      }
    }

    // 位置復元
    if (_mlp_current_slide >= slides.length) _mlp_current_slide = 0;
    slider.style.transform = `translateX(-${_mlp_current_slide * 100}%)`;

    // スワイプ・クリック切替（スライド2枚以上の時のみ）
    if (slides.length > 1) {
      let _start_x = 0;
      slider.ontouchstart = (e) => { _start_x = e.touches[0].clientX; };
      slider.ontouchend = (e) => {
        const dx = e.changedTouches[0].clientX - _start_x;
        if (Math.abs(dx) > 40) {
          dx > 0 ? _mlp_go_to(_mlp_current_slide - 1) : _mlp_go_to(_mlp_current_slide + 1);
        }
      };
      slider.onclick = () => _mlp_go_to(_mlp_current_slide + 1);
      slider.style.cursor = "pointer";
    } else {
      slider.ontouchstart = null;
      slider.ontouchend = null;
      slider.onclick = null;
      slider.style.cursor = "default";
    }
  } catch (e) {
    console.warn("memory stats error:", e);
  }
}

function _mlp_go_to(idx) {
  const slider = document.getElementById("mlp_slider");
  const dots = document.querySelectorAll(".mlp_dot");
  const count = slider?.children.length || 1;
  if (idx < 0) idx = count - 1;
  if (idx >= count) idx = 0;
  _mlp_current_slide = idx;
  slider.style.transform = `translateX(-${idx * 100}%)`;
  dots.forEach((d, i) => d.classList.toggle("active", i === idx));
}

// ========== Magic Words ==========
(function init_magic_words() {
  const toggle = document.getElementById("btn_magic_toggle");
  const panel = document.getElementById("magic_words");
  if (!toggle || !panel) return;

  toggle.addEventListener("click", () => {
    const visible = panel.style.display !== "none";
    panel.style.display = visible ? "none" : "flex";
    toggle.classList.toggle("active", !visible);
  });

  panel.addEventListener("click", (e) => {
    const chip = e.target.closest(".magic_chip");
    if (!chip) return;
    const input = document.getElementById("composer_input");
    if (!input) return;

    // 挙手（name_pick）: 参加者名ポップアップを出す
    if (chip.dataset.wrap === "name_pick" && is_multi_mode && multi_participants.length > 0) {
      _show_name_pick_popup(chip, input);
      return;
    }
    // @メンション: 参加者名ポップアップ → "@名前、" をインプットに挿入
    if (chip.dataset.wrap === "mention_pick" && is_multi_mode && multi_participants.length > 0) {
      _show_mention_popup(chip, input);
      return;
    }
    // 途中参加（name_add）
    if (chip.dataset.wrap === "name_add" && is_multi_mode) {
      const v = input.value.trim();
      if (v) {
        // 名前が入力済み → セレベにお願いテキストに変換
        input.value = `セレベ、${v}を参加させて。`;
        input.focus();
      } else {
        // 空 → 会議設定モーダル
        _show_meeting_edit_modal();
      }
      return;
    }
    // 途中退出（name_remove）
    if (chip.dataset.wrap === "name_remove" && is_multi_mode) {
      const v = input.value.trim();
      if (v) {
        input.value = `セレベ、${v}を退出させて。`;
        input.focus();
      } else if (multi_participants.length > 2) {
        _show_name_remove_popup(chip, input);
      }
      return;
    }

    // レイヤー選択ポップアップ: #進行 / #参加 / #混合
    if (chip.dataset.wrap === "layer_pick" && is_multi_mode) {
      _show_layer_popup(chip, input);
      return;
    }

    // モード変更ポップアップ: 順番 / ブラインド / フリー / 指名
    if (chip.dataset.wrap === "mode_pick" && is_multi_mode) {
      _show_mode_popup(chip, input);
      return;
    }

    // 発言順かえて: 参加者名を使った例を2行目に入れる
    if (chip.dataset.wrap === "reorder_hint" && is_multi_mode && multi_participants.length > 0) {
      const names = multi_participants.map(p => p.actor_name);
      // 現在の順番をシャッフルして例として表示
      const shuffled = [...names].sort(() => Math.random() - 0.5);
      const arrow = get_lang() === "en" ? " → " : " → ";
      const hint_line = shuffled.join(arrow);
      input.value = (chip.dataset.text || "") + "\n" + hint_line;
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
      input.dispatchEvent(new Event("input"));
      return;
    }

    const current = input.value.trim();
    const chip_text = chip.dataset.text || "";
    if (current && chip_text) {
      // 既存テキストがある場合は追記
      input.value = current + " " + chip_text;
    } else if (current) {
      const wrap = chip.dataset.wrap || "{v}";
      input.value = wrap.replace("{v}", current);
    } else {
      input.value = chip_text;
    }
    input.focus();
    input.dispatchEvent(new Event("input"));
  });

  // 挙手ボタン（フリーモード専用）= 自動進行を止めてユーザの発言を待つ
  const raise_btn = document.getElementById("btn_raise_hand");
  if (raise_btn) {
    raise_btn.addEventListener("click", () => {
      if (!is_multi_mode) return;
      if (_free_continue_running) {
        _free_mode_stop();
        add_cerebellum_message("🧠 " + t("raise_hand_stop"));
      }
      const input = document.getElementById("composer_input");
      if (input) input.focus();
    });
  }
})();

// ========== Knowledge Magic Chips ==========
async function _load_knowledge_magic_chips() {
  const panel = document.getElementById("magic_words");
  if (!panel) return;
  try {
    const res = await fetch("/api/knowledge/magic");
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];

    // 既存のナレッジ由来chipを除去（再読み込み対応）
    panel.querySelectorAll(".magic_chip[data-knowledge-magic]").forEach(el => el.remove());

    // 既存chipのdata-textを収集して重複チェック用セットを作る
    const existing = new Set();
    panel.querySelectorAll(".magic_chip").forEach(el => {
      if (el.dataset.text) existing.add(el.dataset.text);
    });

    for (const item of items) {
      const sc = (item.shortcut || "").trim();
      if (!sc) continue;
      const chip_text = "#" + sc;
      if (existing.has(chip_text)) continue; // 重複スキップ
      const btn = document.createElement("button");
      btn.className = "magic_chip";
      btn.dataset.text = chip_text;
      btn.dataset.knowledgeMagic = "1";
      btn.textContent = chip_text;
      panel.appendChild(btn);
    }
  } catch (e) {
    console.warn("knowledge magic chips load error:", e);
  }
}
// ページ読み込み時に実行
_load_knowledge_magic_chips();

function _show_raise_hand_popup(anchor, input) {
  document.getElementById("name_pick_popup")?.remove();

  const popup = document.createElement("div");
  popup.id = "name_pick_popup";
  popup.style.cssText = "position:absolute;bottom:calc(100% + 8px);left:0;background:#1a1a1a;border:1px solid #34d399;border-radius:8px;padding:6px;z-index:100;display:flex;gap:4px;flex-wrap:wrap;";

  const lang = (localStorage.getItem("epl_lang") || "ja").startsWith("en") ? "en" : "ja";
  for (const p of multi_participants) {
    const btn = document.createElement("button");
    btn.style.cssText = `background:${p.color || '#555'};color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;`;
    btn.textContent = p.actor_name;
    btn.addEventListener("click", async () => {
      popup.remove();
      // フリーモード自動進行中なら停止して指名
      if (_free_continue_running) {
        await _free_mode_stop();
        // 指名リクエスト: サーバーにraise_hand_actor_idを送って即座にその人に喋らせる
        const th = add_thinking();
        try {
          const res = await fetch("/api/multi/continue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_thread_id: chat_thread_id, raise_hand_actor_id: p.actor_id }),
          });
          const data = await res.json();
          remove_thinking(th);
          _render_multi_responses(data);
        } catch (e) {
          remove_thinking(th);
          console.error("[RAISE-HAND]", e);
        }
        // 挙手後はユーザの発言を待つ（自動進行は再開しない）
      } else {
        // 自動進行中でなければ、入力欄にテキスト挿入（従来動作）
        if (lang === "en") {
          input.value = `I want to hear from ${p.actor_name}.`;
        } else {
          input.value = `${p.actor_name}に聞きたい。`;
        }
        input.focus();
        input.dispatchEvent(new Event("input"));
      }
    });
    popup.appendChild(btn);
  }

  anchor.style.position = "relative";
  anchor.appendChild(popup);
  setTimeout(() => {
    const dismiss = (e) => { if (!popup.contains(e.target) && e.target !== anchor) { popup.remove(); document.removeEventListener("click", dismiss); } };
    document.addEventListener("click", dismiss);
  }, 10);
}

function _show_name_pick_popup(chip, input) {
  // 既存のポップアップがあれば消す
  document.getElementById("name_pick_popup")?.remove();

  const popup = document.createElement("div");
  popup.id = "name_pick_popup";
  const rect = chip.getBoundingClientRect();
  const _left = Math.min(rect.left, window.innerWidth - 300);
  const _bottom = window.innerHeight - rect.top + 6;
  popup.style.cssText = `position:fixed;left:${Math.max(8, _left)}px;bottom:${_bottom}px;background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:6px;z-index:9999;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100vw - 16px);box-shadow:0 -4px 16px rgba(0,0,0,0.5);`;

  const lang = (localStorage.getItem("epl_lang") || "ja").startsWith("en") ? "en" : "ja";
  for (const p of multi_participants) {
    const btn = document.createElement("button");
    btn.style.cssText = `background:${p.color || '#555'};color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;`;
    btn.textContent = p.actor_name;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (lang === "en") {
        input.value = `I want to hear from ${p.actor_name}.`;
      } else {
        input.value = `${p.actor_name}に聞きたい。`;
      }
      input.focus();
      input.dispatchEvent(new Event("input"));
      popup.remove();
    });
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  setTimeout(() => {
    const _close = (e) => {
      if (!popup.contains(e.target) && e.target !== chip) {
        popup.remove();
        document.removeEventListener("click", _close);
      }
    };
    document.addEventListener("click", _close);
  }, 200);
}

function _show_mention_popup(chip, input) {
  document.getElementById("name_pick_popup")?.remove();

  const popup = document.createElement("div");
  popup.id = "name_pick_popup";
  const rect = chip.getBoundingClientRect();
  const _left = Math.min(rect.left, window.innerWidth - 300);
  const _bottom = window.innerHeight - rect.top + 6;
  popup.style.cssText = `position:fixed;left:${Math.max(8, _left)}px;bottom:${_bottom}px;background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:6px;z-index:9999;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100vw - 16px);box-shadow:0 -4px 16px rgba(0,0,0,0.5);`;

  const _comma = get_lang() === "en" ? ", " : "、";

  // セレベ（進行役AI）を先頭に追加
  const cBtn = document.createElement("button");
  cBtn.style.cssText = `background:#7c5cbf;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;`;
  cBtn.textContent = t("mention_cerebellum");
  cBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const _name = get_lang() === "en" ? "Cerebellum" : "セレベ";
    const current = input.value.trim();
    input.value = current ? `@${_name}${_comma}${current}` : `@${_name}${_comma}`;
    input.focus();
    input.dispatchEvent(new Event("input"));
    popup.remove();
  });
  popup.appendChild(cBtn);

  for (const p of multi_participants) {
    const btn = document.createElement("button");
    btn.style.cssText = `background:${p.color || '#555'};color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;`;
    btn.textContent = p.actor_name;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const current = input.value.trim();
      input.value = current ? `@${p.actor_name}${_comma}${current}` : `@${p.actor_name}${_comma}`;
      input.focus();
      input.dispatchEvent(new Event("input"));
      popup.remove();
    });
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  setTimeout(() => {
    const _close = (e) => {
      if (!popup.contains(e.target) && e.target !== chip) {
        popup.remove();
        document.removeEventListener("click", _close);
      }
    };
    document.addEventListener("click", _close);
  }, 200);
}

function _show_layer_popup(chip, input) {
  document.getElementById("name_pick_popup")?.remove();

  const popup = document.createElement("div");
  popup.id = "name_pick_popup";
  const rect = chip.getBoundingClientRect();
  const _left = Math.min(rect.left, window.innerWidth - 260);
  const _bottom = window.innerHeight - rect.top + 6;
  popup.style.cssText = `position:fixed;left:${Math.max(8, _left)}px;bottom:${_bottom}px;background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:6px;z-index:9999;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100vw - 16px);box-shadow:0 -4px 16px rgba(0,0,0,0.5);`;

  const layers = [
    { tag: "#進行", color: "#5c7cbf", desc: "進行・指示" },
    { tag: "#参加", color: "#5cbf7c", desc: "討論参加" },
    { tag: "#混合", color: "#bf8c5c", desc: "進行+参加" },
  ];

  const _allTags = layers.map(l => l.tag);

  for (const l of layers) {
    const btn = document.createElement("button");
    btn.style.cssText = `background:${l.color};color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;`;
    btn.textContent = `${l.tag} ${l.desc}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      let current = input.value;
      // 既存のレイヤータグを除去（差し替え）
      for (const t of _allTags) {
        const re = new RegExp("^" + t.replace("#", "\\#") + "\\s*\\n?", "");
        current = current.replace(re, "");
      }
      current = current.trimStart();
      input.value = l.tag + "\n" + current;
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
      input.dispatchEvent(new Event("input"));
      popup.remove();
    });
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  setTimeout(() => {
    const _close = (e) => {
      if (!popup.contains(e.target) && e.target !== chip) {
        popup.remove();
        document.removeEventListener("click", _close);
      }
    };
    document.addEventListener("click", _close);
  }, 200);
}

function _show_mode_popup(chip, input) {
  document.getElementById("name_pick_popup")?.remove();

  const popup = document.createElement("div");
  popup.id = "name_pick_popup";
  const rect = chip.getBoundingClientRect();
  const _left = Math.min(rect.left, window.innerWidth - 320);
  const _bottom = window.innerHeight - rect.top + 6;
  popup.style.cssText = `position:fixed;left:${Math.max(8, _left)}px;bottom:${_bottom}px;background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:6px;z-index:9999;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100vw - 16px);box-shadow:0 -4px 16px rgba(0,0,0,0.5);`;

  const modes = [
    { key: "sequential",  color: "#4a7abf", label: t("mode_sequential"),  text: t("mmw_sequential_text") },
    { key: "blind",       color: "#bf4a8c", label: t("mode_blind"),       text: t("mmw_blind_text") },
    { key: "free",        color: "#2aab7a", label: t("mode_free"),        text: t("mmw_free_text") },
    { key: "nomination",  color: "#c9951c", label: t("mode_nomination"),  text: t("mmw_nomination_text") },
  ];

  for (const m of modes) {
    const btn = document.createElement("button");
    const is_current = multi_conv_mode === m.key;
    btn.style.cssText = `background:${is_current ? m.color : "transparent"};color:${is_current ? "#fff" : m.color};border:1.5px solid ${m.color};border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;opacity:${is_current ? "0.5" : "1"};transition:all 0.12s;`;
    btn.textContent = m.label + (is_current ? " ✓" : "");
    if (!is_current) {
      btn.addEventListener("mouseenter", () => { btn.style.background = m.color; btn.style.color = "#fff"; });
      btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; btn.style.color = m.color; });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        input.value = m.text;
        input.focus();
        input.dispatchEvent(new Event("input"));
        popup.remove();
      });
    }
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  setTimeout(() => {
    const _close = (e) => {
      if (!popup.contains(e.target) && e.target !== chip) {
        popup.remove();
        document.removeEventListener("click", _close);
      }
    };
    document.addEventListener("click", _close);
  }, 200);
}

async function _show_name_add_popup(chip, input) {
  document.getElementById("name_pick_popup")?.remove();
  // 全アクター取得、現参加者を除外
  let res, data;
  try {
    res = await fetch("/api/actor");
    data = await res.json();
  } catch (e) {
    console.error("[name_add_popup] fetch error:", e);
    return;
  }
  const all_actors = (data.actor || []).filter(a => !a.is_ov);
  const current_aids = new Set(multi_participants.map(p => p.actor_id));
  const available = all_actors.filter(a => !current_aids.has(a.actor_id));
  console.log(`[name_add_popup] all=${all_actors.length} current=${current_aids.size} available=${available.length}`);

  if (available.length === 0) {
    input.value = "";
    input.placeholder = t("no_actors_available") || "追加できるアクターがありません";
    setTimeout(() => { input.placeholder = t("meeting_composer_ph"); }, 2000);
    return;
  }

  const popup = document.createElement("div");
  popup.id = "name_pick_popup";
  // chipの位置を基準にfixedで表示（overflow:hiddenの影響を受けない）
  const rect = chip.getBoundingClientRect();
  popup.style.cssText = `position:fixed;left:${rect.left}px;bottom:${window.innerHeight - rect.top + 6}px;background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:6px;z-index:9999;display:flex;gap:4px;flex-wrap:wrap;max-width:80vw;box-shadow:0 -4px 16px rgba(0,0,0,0.5);`;

  for (const a of available) {
    const btn = document.createElement("button");
    btn.style.cssText = "background:#2ecc71;color:#000;border:none;border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;";
    btn.textContent = `+ ${a.name}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      input.value = `${a.name}を参加させて。`;
      input.focus();
      input.dispatchEvent(new Event("input"));
      popup.remove();
    });
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  // クリック外で閉じる
  setTimeout(() => {
    const _close = (e) => {
      if (!popup.contains(e.target) && e.target !== chip) {
        popup.remove();
        document.removeEventListener("click", _close);
      }
    };
    document.addEventListener("click", _close);
  }, 200);
}

function _show_name_remove_popup(chip, input) {
  document.getElementById("name_pick_popup")?.remove();
  const popup = document.createElement("div");
  popup.id = "name_pick_popup";
  const rect = chip.getBoundingClientRect();
  const _left = Math.min(rect.left, window.innerWidth - 300);
  const _bottom = window.innerHeight - rect.top + 6;
  popup.style.cssText = `position:fixed;left:${Math.max(8, _left)}px;bottom:${_bottom}px;background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:6px;z-index:9999;display:flex;gap:4px;flex-wrap:wrap;max-width:calc(100vw - 16px);box-shadow:0 -4px 16px rgba(0,0,0,0.5);`;

  for (const p of multi_participants) {
    const btn = document.createElement("button");
    btn.style.cssText = `background:${p.color || '#e74c3c'};color:#000;border:none;border-radius:6px;padding:4px 10px;font-size:0.8rem;cursor:pointer;font-weight:600;`;
    btn.textContent = `- ${p.actor_name}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      input.value = `${p.actor_name}を退出させて。`;
      input.focus();
      input.dispatchEvent(new Event("input"));
      popup.remove();
    });
    popup.appendChild(btn);
  }

  document.body.appendChild(popup);
  setTimeout(() => {
    const _close = (e) => {
      if (!popup.contains(e.target) && e.target !== chip) {
        popup.remove();
        document.removeEventListener("click", _close);
      }
    };
    document.addEventListener("click", _close);
  }, 200);
}

// ========== Start ==========
apply_i18n();  // i18n 初期適用

// 言語切り替え後のサイドバー自動オープン
if (localStorage.getItem("epl_sidebar_open") === "1") {
  localStorage.removeItem("epl_sidebar_open");
  const sb = document.getElementById("sidebar");
  if (sb) sb.classList.add("is_open");
}

// ========== DiaLogSea 再生エンジン ==========

let _replay_active = false;
let _replay_data = [];
let _replay_index = 0;
let _replay_labels = {};  // label name → index
let _replay_typing = false;
let _replay_skip_typing = false;
let _replay_speaker = null;  // { name, label, color }
let _replay_last_speaker = null;  // 前回表示したスピーカー名
let _replay_visited = {};  // label name → 訪問回数
let _replay_option_visited = {};  // option id → 選択回数

async function _start_replay(json_url) {
  if (_replay_active) return;
  try {
    const res = await fetch(json_url);
    _replay_data = await res.json();
  } catch (e) {
    console.error("[REPLAY] Failed to load:", e);
    return;
  }
  _replay_active = true;
  _replay_index = 0;
  _replay_typing = false;
  _replay_visited = {};
  _replay_option_visited = {};

  // label → index マップ構築
  _replay_labels = {};
  _replay_data.forEach((msg, i) => {
    if (msg.role === "label" && msg.name) _replay_labels[msg.name] = i;
  });

  // {owner_name} 変数展開
  let owner_name = (get_lang() === "en") ? "you" : "あなた";
  try {
    const cfg_res = await fetch(`/api/config?chat_thread_id=`);
    const cfg = await cfg_res.json();
    if (cfg.user_nickname && cfg.user_nickname !== "初期ユーザ") owner_name = cfg.user_nickname;
  } catch (e) {}
  _replay_data.forEach(msg => {
    if (msg.text) msg.text = msg.text.replace(/\{owner_name\}/g, owner_name);
  });

  // UI準備
  chat_el.innerHTML = "";
  _set_topbar_mode("no_chat");
  const composer = document.getElementById("composer_dock");
  if (composer) {
    composer.style.pointerEvents = "none";
    composer.style.opacity = "0.3";
  }

  // 「次へ」ボタン（チャットエリア内、中央配置）
  const next_btn = document.createElement("button");
  next_btn.id = "replay_next_btn";
  next_btn.className = "replay_next_btn";
  next_btn.textContent = t("replay_next") || "次へ ▶";
  next_btn.addEventListener("click", () => _replay_next());
  // キーヒント
  const key_hint = document.createElement("div");
  key_hint.className = "replay_key_hint";
  key_hint.textContent = t("replay_key_hint") || "↵ Enter / Space でも進めます";
  next_btn.appendChild(document.createElement("br"));
  next_btn.appendChild(key_hint);
  chat_el.appendChild(next_btn);

  // キーボードで進行 / タイピングスキップ / 選択肢移動
  const _replay_keydown = (e) => {
    if (!_replay_active) { document.removeEventListener("keydown", _replay_keydown); return; }
    // 選択肢が表示中か判定
    const _choice_btns = document.querySelectorAll(".replay_choice_btn");
    if (_choice_btns.length > 0) {
      // 選択肢モード: 矢印キーで移動、Enter/Spaceで決定
      let _cur_idx = -1;
      _choice_btns.forEach((b, i) => { if (b.classList.contains("is_focused")) _cur_idx = i; });
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const next_idx = _cur_idx < 0 ? 0 : (_cur_idx + 1) % _choice_btns.length;
        _choice_btns.forEach(b => b.classList.remove("is_focused"));
        _choice_btns[next_idx].classList.add("is_focused");
        _choice_btns[next_idx].scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next_idx = _cur_idx < 0 ? _choice_btns.length - 1 : (_cur_idx - 1 + _choice_btns.length) % _choice_btns.length;
        _choice_btns.forEach(b => b.classList.remove("is_focused"));
        _choice_btns[next_idx].classList.add("is_focused");
        _choice_btns[next_idx].scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (_cur_idx >= 0) {
          _choice_btns[_cur_idx].click();
        } else {
          // 未選択なら最初をフォーカス
          _choice_btns[0].classList.add("is_focused");
        }
      }
      return;
    }
    // 通常モード: Enter/Spaceで進行/スキップ
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (_replay_typing) {
        _replay_skip_typing = true;
      } else {
        _replay_next();
      }
    }
  };
  document.addEventListener("keydown", _replay_keydown);

  // 下部余白（キャラクターとの被り防止）
  const spacer = document.createElement("div");
  spacer.id = "replay_spacer";
  spacer.style.height = "200px";
  chat_el.appendChild(spacer);

  // 最初のメッセージへ
  _replay_next();
}

function _stop_replay() {
  _replay_active = false;
  _replay_data = [];
  _replay_index = 0;
  _replay_labels = {};
  _replay_speaker = null;
  _replay_last_speaker = null;
  document.getElementById("replay_next_btn")?.remove();
  document.getElementById("replay_spacer")?.remove();
  const composer = document.getElementById("composer_dock");
  if (composer) {
    composer.style.pointerEvents = "";
    composer.style.opacity = "";
  }
  // 「新規チャットに戻る」ボタン
  const back_btn = document.createElement("button");
  back_btn.className = "replay_next_btn";
  back_btn.textContent = t("replay_back") || "新規チャットに戻る";
  const back_hint = document.createElement("div");
  back_hint.className = "replay_key_hint";
  back_hint.textContent = t("replay_key_hint") || "↵ Enter / Space でも進めます";
  back_btn.appendChild(document.createElement("br"));
  back_btn.appendChild(back_hint);
  const _do_back = () => {
    document.removeEventListener("keydown", _back_keydown);
    back_btn.remove();
    _back_spacer.remove();
    show_new_chat_screen();
  };
  back_btn.addEventListener("click", _do_back);
  const _back_keydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); _do_back(); }
  };
  document.addEventListener("keydown", _back_keydown);
  const _back_spacer = document.createElement("div");
  _back_spacer.style.height = "200px";
  chat_el.appendChild(back_btn);
  chat_el.appendChild(_back_spacer);
  back_btn.scrollIntoView({ behavior: "smooth", block: "center" });
}

function _replay_next() {
  if (!_replay_active || _replay_typing) return;
  while (_replay_index < _replay_data.length) {
    const msg = _replay_data[_replay_index];
    _replay_index++;

    if (msg.role === "blank") {
      if (msg.stop) { _stop_replay(); return; }
      continue;  // blankはスキップ
    }
    if (msg.role === "label") continue;  // labelはスキップ
    if (msg.role === "speaker") {
      _replay_speaker = { name: msg.name || "", label: msg.label || "", color: msg.color || "#aaa" };
      continue;  // スピーカー設定だけ、表示はしない
    }
    if (msg.role === "action") {
      _replay_do_action(msg);
      continue;
    }
    if (msg.role === "goto") {
      const target = _replay_labels[msg.target];
      if (target !== undefined) _replay_index = target + 1;
      continue;
    }
    if (msg.role === "assistant") {
      _replay_show_assistant(msg.text);
      return;  // 次のクリックまで停止
    }
    if (msg.role === "user") {
      _replay_show_user(msg.text);
      return;
    }
    if (msg.role === "choice") {
      _replay_show_choice(msg);
      return;
    }
  }
  // データ末尾に到達
  _stop_replay();
}

function _replay_do_action(msg) {
  if (msg.type === "sandwich") {
    // box-shadowサンドイッチをチャット内に表示
    const _sw_colors = {
      a:"#D2AA6E",b:"#A88858",c:"#7E6642",d:"#C0C4B8",e:"#90938A",f:"#F0F5E6",
      g:"#8CBE5A",i:"#709848",j:"#547236",k:"#FFD23C",l:"#CCA830",m:"#FFC828",
      n:"#B86038",o:"#8A482A",p:"#E67846",q:"#997E24",r:"#DC96A0",s:"#B07880",
      t:"#845A60",u:"#FF0000",v:"#990000",w:"#CC0000",x:"#1E2864",y:"#283278",
    };
    const _sw_grid = [
      "_____aaaaaaaaaaaaaaaaaaaaaaa____",
      "___aababababababababababababaa__",
      "___abcbcbcbcccbcbcbcccbcbcbcba__",
      "___bcdedededededededededededcb__",
      "___cdfdfdfdfdfdfdfdfdfdfdfdfdc__",
      "___dfgggggggggggggggggggggggfd__",
      "__ffggigggigigggigggigggggiggff_",
      "_f_gjijijijijijijijijijijijijg_f",
      "___iklkkkkkkkkklkkkklkklkkklkim_",
      "__mkkkkklklklklkkkkkkkkkkkkklkm_",
      "_mlklklkklklklklklklklkkklkkkklm",
      "_lmlklklnnoklnoklklklklklnklklml",
      "_mnpklklppnlqpplklklppnlkplknkl_",
      "_lpnlllqnppqlnplqmlknppklpklplq_",
      "_qqnolqnonolnonollqnonononlonql_",
      "__lrrqrrrrrrrrrrqqlrrrrrrrqrrlq_",
      "__qrslrsrsrsrsrsqlqrsrsrsrlsrql_",
      "__qstqstststststqqqstststsqtsrsl",
      "___uvqwwwvwvwvwwwqquvwvwuwqwuwq_",
      "___uuwuuuuuuuuuuuquuuuuuuuwuuu__",
      "___uvwvwwvwvwvwvwvwvwvwvwvwvwu__",
      "__xyyyyyyyyyyyyyyyyyyyyyyyyyyyx_",
      "_xxyyyyyyyyyyyyyyyyyyyyyyyyyyyxx",
      "__xyyyyyyyyyyyyyyyyyyyyyyyyyyyx_",
      "__xyaaxaaaaaaaxxaaaaaaaaxaaaayx_",
      "__xbbaxbabababxxababababxbabbbx_",
      "___cbbxbbbbbbbxxbbbbbbbbbbbbcc__",
      "_____cbcbcbcbcxxbcbcbcbcbcbc____",
    ];
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;justify-content:center;margin:16px 0;";
    const sw = document.createElement("div");
    const _px = 4;
    sw.style.cssText = "width:" + _px + "px;height:" + _px + "px;image-rendering:pixelated;";
    sw.style.boxShadow = _grid_to_shadow(_sw_grid, _sw_colors, _px, _px);
    sw.title = (get_lang() === "en") ? "9-Layer Personality Sandwich" : "9層の人格サンドイッチ";
    wrap.appendChild(sw);
    const spacer = document.getElementById("replay_spacer");
    const next_btn = document.getElementById("replay_next_btn");
    if (spacer) chat_el.insertBefore(wrap, next_btn || spacer);
    else chat_el.appendChild(wrap);
    wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function _replay_show_assistant(text) {
  // スピーカーバッジ（設定されていて、前回と違うスピーカーの場合のみ表示）
  if (_replay_speaker && _replay_speaker.name && _replay_speaker.name !== _replay_last_speaker) {
    _replay_last_speaker = _replay_speaker.name;
    const badge_wrap = document.createElement("div");
    badge_wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:12px 0 2px 4px;";
    const name_el = document.createElement("span");
    name_el.style.cssText = `font-size:0.78rem;font-weight:600;color:${_replay_speaker.color};`;
    name_el.textContent = _replay_speaker.name;
    badge_wrap.appendChild(name_el);
    if (_replay_speaker.label) {
      const label_el = document.createElement("span");
      label_el.style.cssText = `font-size:0.68rem;color:#888;background:#1a1a1a;border:1px solid ${_replay_speaker.color}44;border-radius:4px;padding:1px 6px;`;
      label_el.textContent = _replay_speaker.label;
      badge_wrap.appendChild(label_el);
    }
    const _sp = document.getElementById("replay_spacer");
    const _nb = document.getElementById("replay_next_btn");
    if (_sp) chat_el.insertBefore(badge_wrap, _nb || _sp);
    else chat_el.appendChild(badge_wrap);
  }

  const bubble = document.createElement("div");
  bubble.className = "message_bubble ai_bubble replay_bubble";
  bubble.style.cssText = "max-width:70%;margin:2px 0 8px 0;padding:10px 14px;background:var(--bubble_ai);border-radius:12px 12px 12px 2px;color:var(--text);font-size:0.9rem;line-height:1.6;white-space:pre-wrap;opacity:0;transition:opacity 0.3s;";
  // spacerの前に挿入（常にspacerが最後に来るように）
  const spacer = document.getElementById("replay_spacer");
  const next_btn = document.getElementById("replay_next_btn");
  if (spacer) chat_el.insertBefore(bubble, next_btn || spacer);
  else chat_el.appendChild(bubble);

  // タイピングアニメーション
  _replay_typing = true;
  _replay_skip_typing = false;
  const _next = document.getElementById("replay_next_btn");
  if (_next) _next.classList.add("is_hidden");  // ふわっと消す
  let i = 0;
  const chars = [...text];
  bubble.style.opacity = "1";
  const _scroll = () => { bubble.scrollIntoView({ behavior: "smooth", block: "center" }); };
  // バブルクリックでもスキップ（ドラクエ方式ｗ）
  bubble.style.cursor = "pointer";
  bubble.addEventListener("click", () => { if (_replay_typing) _replay_skip_typing = true; });
  const timer = setInterval(() => {
    if (_replay_skip_typing && i < chars.length) {
      // 一気に残り全部表示
      bubble.textContent = text;
      i = chars.length;
      clearInterval(timer);
      _replay_typing = false;
      _replay_skip_typing = false;
      _scroll();
      if (_next) _next.classList.remove("is_hidden");
      return;
    }
    if (i < chars.length) {
      bubble.textContent += chars[i];
      i++;
      if (i % 10 === 0) _scroll();
    } else {
      clearInterval(timer);
      _replay_typing = false;
      _scroll();
      if (_next) _next.classList.remove("is_hidden");  // ふわっと戻す
    }
  }, 30);
}

function _replay_show_user(text) {
  const bubble = document.createElement("div");
  bubble.className = "message_bubble user_bubble";
  bubble.style.cssText = "max-width:70%;margin:8px 0 8px auto;padding:10px 14px;background:var(--bubble_user);border-radius:12px 12px 2px 12px;color:var(--text);font-size:0.9rem;line-height:1.6;white-space:pre-wrap;";
  bubble.textContent = text;
  const spacer = document.getElementById("replay_spacer");
  const next_btn = document.getElementById("replay_next_btn");
  if (spacer) chat_el.insertBefore(bubble, next_btn || spacer);
  else chat_el.appendChild(bubble);
  bubble.scrollIntoView({ behavior: "smooth", block: "center" });
}

function _replay_show_choice(msg) {
  const wrap = document.createElement("div");
  wrap.className = "replay_choice_wrap";
  wrap.style.cssText = "display:flex;flex-direction:column;gap:8px;margin:16px 0;padding:0 16px;";
  if (msg.text) {
    const label = document.createElement("div");
    label.style.cssText = "font-size:0.82rem;color:var(--text_dim);margin-bottom:4px;";
    label.textContent = msg.text;
    wrap.appendChild(label);
  }
  (msg.options || []).forEach(opt => {
    // 選択回数に応じてlabel/gotoを切り替える（labels/gotos + hide_after）
    let _label = opt.label;
    let _goto = opt.goto;
    if (opt.id && opt.labels && opt.gotos) {
      const _cnt = _replay_option_visited[opt.id] || 0;
      if (opt.hide_after && _cnt >= opt.hide_after) return;  // 非表示
      _label = opt.labels[Math.min(_cnt, opt.labels.length - 1)];
      _goto = opt.gotos[Math.min(_cnt, opt.gotos.length - 1)];
    }
    const btn = document.createElement("button");
    btn.className = "replay_choice_btn";
    btn.style.cssText = "background:var(--bubble_ai);border:1px solid var(--accent);color:var(--text);border-radius:12px;padding:10px 16px;font-size:0.88rem;cursor:pointer;text-align:left;transition:background 0.2s;";
    btn.textContent = _label;
    btn.addEventListener("mouseenter", () => { btn.style.background = "var(--accent)"; btn.style.color = "#000"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "var(--bubble_ai)"; btn.style.color = "var(--text)"; });
    btn.addEventListener("click", () => {
      // 選択をユーザー発言として表示
      _replay_show_user(_label);
      wrap.remove();
      // 「次へ」ボタン復活
      const next_btn = document.getElementById("replay_next_btn");
      if (next_btn) next_btn.style.display = "";
      // 選択回数を記録
      if (opt.id) _replay_option_visited[opt.id] = (_replay_option_visited[opt.id] || 0) + 1;
      // goto先にジャンプ
      if (_goto && _replay_labels[_goto] !== undefined) {
        _replay_visited[_goto] = (_replay_visited[_goto] || 0) + 1;
        _replay_index = _replay_labels[_goto] + 1;
      }
      _replay_next();
    });
    wrap.appendChild(btn);
  });
  const spacer = document.getElementById("replay_spacer");
  const next_btn = document.getElementById("replay_next_btn");
  if (spacer) chat_el.insertBefore(wrap, next_btn || spacer);
  else chat_el.appendChild(wrap);
  wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  // choice表示中は「次へ」ボタンを隠す
  if (next_btn) next_btn.style.display = "none";
  // 最初のボタンにフォーカス（キーボード操作用）
  const _first_btn = wrap.querySelector(".replay_choice_btn");
  if (_first_btn) _first_btn.classList.add("is_focused");
}

// チュートリアル起動（マスコットクリック or ヘルプボタン）
function _launch_adoko_tutorial() {
  if (_replay_active) return;
  const _lang = get_lang();
  const _en_url = "/static/replay/tutorial_adoko_en.json";
  const _ja_url = "/static/replay/tutorial_adoko.json";
  if (_lang === "en") {
    fetch(_en_url, { method: "HEAD" }).then(r => {
      _start_replay(r.ok ? _en_url : _ja_url);
    }).catch(() => _start_replay(_ja_url));
  } else {
    _start_replay(_ja_url);
  }
}

// マスコット（アド子）クリックでチュートリアル起動
document.addEventListener("click", (e) => {
  if (_replay_active) return;
  if (e.target.closest(".mascot_hint")) _launch_adoko_tutorial();
});

// ヘルプボタンでチュートリアル起動（新規チャット画面のみ表示）
document.getElementById("btn_help_tutorial")?.addEventListener("click", _launch_adoko_tutorial);

// ========== OpenRouter 管理モーダル ==========

window.open_openrouter_mgr_modal = async function() {
  const modal = document.getElementById("openrouter_mgr_modal");
  const textarea = document.getElementById("openrouter_mgr_json");
  const err_el = document.getElementById("openrouter_mgr_error");
  if (!modal || !textarea) return;
  if (err_el) err_el.textContent = "";
  try {
    const res = await fetch("/api/openrouter/recommended");
    const data = await res.json();
    delete data._has_user;
    textarea.value = JSON.stringify(data, null, 2);
  } catch (e) {
    if (err_el) err_el.textContent = "読み込み失敗: " + e.message;
  }
  modal.style.display = "flex";
};

document.getElementById("btn_openrouter_mgr_save")?.addEventListener("click", async () => {
  const textarea = document.getElementById("openrouter_mgr_json");
  const err_el = document.getElementById("openrouter_mgr_error");
  err_el.textContent = "";
  let parsed;
  try {
    parsed = JSON.parse(textarea.value);
  } catch (e) {
    err_el.textContent = "JSON構文エラー: " + e.message;
    return;
  }
  try {
    const res = await fetch("/api/openrouter/recommended", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const result = await res.json();
    if (res.ok) {
      err_el.style.color = "#60e060";
      err_el.textContent = "保存しました（" + result.path + "）";
      // キャッシュクリアして次回取得時に反映
      _openrouter_rec_cache = null;
      for (const k of Object.keys(_MP_MODELS_CACHE)) delete _MP_MODELS_CACHE[k];
      setTimeout(() => { err_el.style.color = "#f06060"; err_el.textContent = ""; }, 3000);
    } else {
      err_el.textContent = "保存失敗: " + (result.error || "unknown");
    }
  } catch (e) {
    err_el.textContent = "保存失敗: " + e.message;
  }
});

document.getElementById("btn_openrouter_mgr_reset")?.addEventListener("click", async () => {
  if (!confirm("システムデフォルトに戻しますか？（ユーザー編集版を削除）")) return;
  const err_el = document.getElementById("openrouter_mgr_error");
  err_el.textContent = "";
  try {
    const res = await fetch("/api/openrouter/recommended", { method: "DELETE" });
    if (res.ok) {
      // 再読み込み
      const get_res = await fetch("/api/openrouter/recommended");
      const data = await get_res.json();
      delete data._has_user;
      document.getElementById("openrouter_mgr_json").value = JSON.stringify(data, null, 2);
      err_el.style.color = "#60e060";
      err_el.textContent = "デフォルトに戻しました";
      _openrouter_rec_cache = null;
      for (const k of Object.keys(_MP_MODELS_CACHE)) delete _MP_MODELS_CACHE[k];
      setTimeout(() => { err_el.style.color = "#f06060"; err_el.textContent = ""; }, 3000);
    }
  } catch (e) {
    err_el.textContent = "リセット失敗: " + e.message;
  }
});

init_app();
load_sidebar_chats();
init_image_upload();
update_memory_layer_panel();
_check_meeting_button_visibility();
