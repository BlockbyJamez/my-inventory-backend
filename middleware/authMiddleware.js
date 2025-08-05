export function authMiddleware(req, res, next) {
  const username = req.body?.username || req.headers["x-username"];
  if (!username) {
    return res.status(401).json({ error: "未登入或權限不足" });
  }
  req.user = { username };
  next();
}
