/**
 * Claurc Auth SDK
 * Usage sur un site tiers :
 *   <script src="https://id.claurc.com/claurc-auth.js"></script>
 *   <script>
 *     Claurc.init({
 *       clientId: "mon-site.com",
 *       authOrigin: "https://id.claurc.com",
 *       onSuccess: (user, token) => { console.log("Connecté :", user); },
 *       onError: (err) => console.error(err),
 *     });
 *     Claurc.renderButton("#claurc-login-btn");
 *   </script>
 */
(function (window) {
  const STORAGE_TOKEN = "claurc_sdk_token";
  const STORAGE_USER = "claurc_sdk_user";

  let config = {
    clientId: null,
    authOrigin: "https://id.claurc.com",
    redirectUri: window.location.origin,
    onSuccess: () => {},
    onError: () => {},
  };

  let popupRef = null;

  function init(options) {
    config = { ...config, ...options };
    window.addEventListener("message", handleMessage);
  }

  async function handleMessage(event) {
    if (!event.data || event.data.type !== "claurc-auth-success") return;
    // Sécurité : on vérifie que le message vient bien du serveur Claurc configuré
    if (event.origin !== new URL(config.authOrigin).origin) return;

    const { token, user } = event.data;

    try {
      // Double vérification côté serveur : le jeton est bien valide et à jour
      const verified = await verifyToken(token);
      localStorage.setItem(STORAGE_TOKEN, token);
      localStorage.setItem(STORAGE_USER, JSON.stringify(verified.user));
      config.onSuccess(verified.user, token);
    } catch (err) {
      config.onError(err);
    } finally {
      if (popupRef && !popupRef.closed) popupRef.close();
    }
  }

  async function verifyToken(token) {
    const res = await fetch(`${config.authOrigin}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Jeton Claurc invalide ou expiré.");
    return res.json();
  }

  function login() {
    if (!config.clientId) {
      config.onError(new Error("Claurc.init({clientId: ...}) doit être appelé avant login()."));
      return;
    }
    const state = Math.random().toString(36).slice(2);
    const url = new URL("/index.html", config.authOrigin);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state);

    const w = 420, h = 640;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    popupRef = window.open(
      url.toString(),
      "claurc-auth",
      `width=${w},height=${h},left=${left},top=${top}`
    );
  }

  function logout() {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
  }

  function getUser() {
    const raw = localStorage.getItem(STORAGE_USER);
    return raw ? JSON.parse(raw) : null;
  }

  function getToken() {
    return localStorage.getItem(STORAGE_TOKEN);
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function renderButton(selector, opts = {}) {
    const el = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!el) return;
    const btn = document.createElement("button");
    btn.textContent = opts.label || "Se connecter avec Claurc";
    btn.style.cssText =
      "display:inline-flex;align-items:center;gap:8px;background:#e0a94a;color:#1a1305;" +
      "border:none;border-radius:9px;padding:11px 18px;font-weight:700;font-family:sans-serif;" +
      "font-size:14px;cursor:pointer;";
    btn.addEventListener("click", login);
    el.appendChild(btn);
  }

  window.Claurc = { init, login, logout, getUser, getToken, isLoggedIn, renderButton };
})(window);
