export function checkAdmin(req, res, next) {
  try {
    const role = req.body?.role || req.headers["x-role"];
    if (role !== "admin") {
      return res.status(403).json({ error: "只有管理員可執行此操作" });
    }
    next();
  } catch (err) {
    next(err);
  }
}
