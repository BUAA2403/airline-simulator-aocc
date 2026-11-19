/* All work starts from the form submission. No background, telemetry or storage. */
"use strict";

const LIVERY_ORIGIN = "https://livery.airline-simulator.com";
const BRIDGE_ENDPOINT = "http://127.0.0.1:3010/api/session-bridge";
const form = document.querySelector("#connect-form");
const pairingInput = document.querySelector("#pairing-code");
const connectButton = document.querySelector("#connect-button");
const statusElement = document.querySelector("#status");

function showStatus(message, kind = "") {
  statusElement.textContent = message;
  statusElement.dataset.kind = kind;
}

// This function is injected only after an explicit click and an origin check.
// Keep it self-contained: chrome.scripting serializes the function body.
function readOfficialSession() {
  if (location.origin !== "https://livery.airline-simulator.com") {
    return { error: "wrong_origin" };
  }
  try {
    const raw = localStorage.getItem("sb-auth-auth-token");
    if (!raw) return { error: "not_signed_in" };
    if (raw.length > 100000) return { error: "invalid_session" };
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return { error: "invalid_session" };
    }
    const access = stored.access_token;
    const refresh = stored.refresh_token;
    if (
      typeof access !== "string" ||
      access.length > 20000 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access) ||
      typeof refresh !== "string" ||
      refresh.length < 8 ||
      refresh.length > 8192 ||
      /\s/.test(refresh)
    ) {
      return { error: "invalid_session" };
    }
    // Deliberately discard user metadata, provider tokens, and all other fields.
    return { session: { access_token: access, refresh_token: refresh } };
  } catch {
    return { error: "invalid_session" };
  }
}

function bridgeErrorMessage(status) {
  if (status === 400) return "连接信息无效。请重新获取配对码，并确认官方页面仍已登录。";
  if (status === 401 || status === 403 || status === 410) {
    return "配对码无效、过期或已使用。请在本地 AOCC 获取新配对码后重试。";
  }
  if (status === 409) return "AOCC 正在处理连接，请稍后重新获取配对码。";
  if (status === 429) return "请求过于频繁，请稍后重新获取配对码。";
  if (status >= 500) return "AOCC 暂时无法验证官方会话。请检查网络后重新连接。";
  return "连接未完成。请查看本地 AOCC 的连接状态并重试。";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (connectButton.disabled) return;
  if (typeof chrome === "undefined" || !chrome.tabs?.query || !chrome.scripting?.executeScript) {
    showStatus("请在 Chrome 或 Edge 中将本文件夹作为扩展加载后使用。", "error");
    return;
  }
  let pairingCode = pairingInput.value.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(pairingCode)) {
    showStatus("请完整填写本地 AOCC 显示的配对码（至少 32 位）。", "error");
    return;
  }

  connectButton.disabled = true;
  let session = null;
  let controller = null;
  let timeout = null;
  try {
    showStatus("正在检查当前官方标签页…");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let origin;
    try { origin = new URL(tab?.url || "").origin; } catch { origin = ""; }
    if (!tab?.id || origin !== LIVERY_ORIGIN) {
      showStatus("请先切换到已登录的 livery.airline-simulator.com 标签页，再打开扩展。", "error");
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: readOfficialSession,
    });
    const result = results?.[0]?.result;
    if (result?.error === "not_signed_in") {
      showStatus("尚未找到登录会话。请自行在官方涂装编辑器登录后再点击连接。", "error");
      return;
    }
    if (!result?.session) {
      showStatus("无法读取有效会话。请刷新官方页面并确认登录状态后重试。", "error");
      return;
    }
    session = result.session;
    showStatus("正在向本机 AOCC 提交会话并验证…");
    controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(BRIDGE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode, session }),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) {
      // Never display an upstream body: it could contain sensitive details.
      showStatus(bridgeErrorMessage(response.status), "error");
      return;
    }
    pairingInput.value = "";
    showStatus("连接成功。返回本地 AOCC，查看航空公司与同步状态。", "success");
  } catch (error) {
    if (error?.name === "AbortError") {
      showStatus("连接超时。请检查 AOCC 状态；若已连接则无需重试，否则获取新配对码。", "error");
    } else {
      showStatus("无法连接。请确认本机 AOCC 已在 127.0.0.1:3010 启动，并刷新官方标签页后重试。", "error");
    }
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    // Tokens exist only in transient memory for this explicit operation.
    session = null;
    pairingCode = "";
    connectButton.disabled = false;
  }
});
