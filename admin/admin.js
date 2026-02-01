function go(page) {
  window.location.href = `/admin/${page}`;
}

async function logout() {
  await fetch("/api/admin/logout", {
    method: "POST",
    credentials: "include"
  });
  window.location.href = "/admin/login.html";
}

// Optional protection: auto-redirect if session expired
(async function authCheck() {
  const res = await fetch("/api/admin/memory", {
    credentials: "include"
  });
  if (res.status === 401) {
    window.location.href = "/admin/login.html";
  }
})();
