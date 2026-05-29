const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ── Overview metric cards ──────────────────────────────────────────────
router.get('/overview', auth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysInt = parseInt(days);

    const [[totals]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM blogs) AS total_blogs,
        (SELECT COUNT(*) FROM likes) AS total_likes,
        (SELECT COUNT(*) FROM followers) AS total_follows,
        (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL ? DAY) AS new_users,
        (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL ? DAY AND created_at < NOW() - INTERVAL ? DAY) AS prev_users,
        (SELECT COUNT(*) FROM blogs WHERE created_at >= NOW() - INTERVAL ? DAY) AS new_blogs,
        (SELECT COUNT(*) FROM blogs WHERE created_at >= NOW() - INTERVAL ? DAY AND created_at < NOW() - INTERVAL ? DAY) AS prev_blogs,
        (SELECT COUNT(*) FROM likes WHERE liked_at >= NOW() - INTERVAL ? DAY) AS new_likes,
        (SELECT COUNT(*) FROM likes WHERE liked_at >= NOW() - INTERVAL ? DAY AND liked_at < NOW() - INTERVAL ? DAY) AS prev_likes,
        (SELECT COUNT(*) FROM followers WHERE followed_at >= NOW() - INTERVAL ? DAY) AS new_follows,
        (SELECT COUNT(*) FROM followers WHERE followed_at >= NOW() - INTERVAL ? DAY AND followed_at < NOW() - INTERVAL ? DAY) AS prev_follows
    `, [daysInt, daysInt, daysInt * 2, daysInt, daysInt, daysInt * 2, daysInt, daysInt, daysInt * 2, daysInt, daysInt, daysInt * 2]);

    const pct = (curr, prev) => prev > 0 ? (((curr - prev) / prev) * 100).toFixed(1) : curr > 0 ? 100 : 0;

    res.json({
      total_users:  { value: totals.total_users,  change: pct(totals.new_users,   totals.prev_users),   trend: totals.new_users   >= totals.prev_users   ? 'up' : 'down' },
      total_blogs:  { value: totals.total_blogs,  change: pct(totals.new_blogs,   totals.prev_blogs),   trend: totals.new_blogs   >= totals.prev_blogs   ? 'up' : 'down' },
      total_likes:  { value: totals.total_likes,  change: pct(totals.new_likes,   totals.prev_likes),   trend: totals.new_likes   >= totals.prev_likes   ? 'up' : 'down' },
      total_follows:{ value: totals.total_follows,change: pct(totals.new_follows, totals.prev_follows), trend: totals.new_follows >= totals.prev_follows ? 'up' : 'down' },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── User growth over time ──────────────────────────────────────────────
router.get('/user-growth', auth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysInt = parseInt(days);

    const [registrations] = await db.query(`
      SELECT DATE(created_at) AS date, COUNT(*) AS count
      FROM users
      WHERE created_at >= NOW() - INTERVAL ? DAY
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [daysInt]);

    // Fill missing dates with 0
    const map = {};
    registrations.forEach(r => { map[r.date.toISOString().slice(0,10)] = Number(r.count); });

    const result = [];
    for (let i = daysInt - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, registrations: map[key] || 0 });
    }

    // Build cumulative active (users who posted or liked in window)
    const [active] = await db.query(`
      SELECT DATE(created_at) AS date, COUNT(DISTINCT user_id) AS count
      FROM (
        SELECT user_id, created_at FROM blogs WHERE created_at >= NOW() - INTERVAL ? DAY
        UNION ALL
        SELECT user_id, liked_at AS created_at FROM likes WHERE liked_at >= NOW() - INTERVAL ? DAY
      ) combined
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [daysInt, daysInt]);

    const activeMap = {};
    active.forEach(r => { activeMap[r.date.toISOString().slice(0,10)] = Number(r.count); });
    result.forEach(r => { r.active = activeMap[r.date] || 0; });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Blog activity by week ──────────────────────────────────────────────
router.get('/blog-activity', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        YEARWEEK(created_at, 1) AS yw,
        MIN(DATE(created_at)) AS week_start,
        SUM(is_public = TRUE) AS public_count,
        SUM(is_public = FALSE) AS private_count
      FROM blogs
      WHERE created_at >= NOW() - INTERVAL 8 WEEK
      GROUP BY yw
      ORDER BY yw ASC
      LIMIT 8
    `);
    res.json(rows.map(r => ({
      week: r.week_start.toISOString().slice(0,10),
      public: Number(r.public_count),
      private: Number(r.private_count),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Engagement over time ───────────────────────────────────────────────
router.get('/engagement', auth, async (req, res) => {
  try {
    const { days = 30, type = 'likes' } = req.query;
    const daysInt = parseInt(days);

    let query, params;
    if (type === 'likes') {
      query = `
        SELECT DATE(l.liked_at) AS date,
          SUM(CASE WHEN l.user_id != b.user_id THEN 1 ELSE 0 END) AS given,
          SUM(CASE WHEN l.user_id  = b.user_id THEN 1 ELSE 0 END) AS received_self,
          COUNT(*) AS total
        FROM likes l JOIN blogs b ON l.blog_id = b.id
        WHERE l.liked_at >= NOW() - INTERVAL ? DAY
        GROUP BY DATE(l.liked_at) ORDER BY date ASC`;
      params = [daysInt];
    } else if (type === 'follows') {
      query = `
        SELECT DATE(followed_at) AS date,
          COUNT(*) AS given, COUNT(*) AS received
        FROM followers
        WHERE followed_at >= NOW() - INTERVAL ? DAY
        GROUP BY DATE(followed_at) ORDER BY date ASC`;
      params = [daysInt];
    } else {
      query = `
        SELECT DATE(created_at) AS date, COUNT(*) AS reads, COUNT(DISTINCT user_id) AS unique_readers
        FROM blogs
        WHERE created_at >= NOW() - INTERVAL ? DAY
        GROUP BY DATE(created_at) ORDER BY date ASC`;
      params = [daysInt];
    }

    const [rows] = await db.query(query, params);

    const map = {};
    rows.forEach(r => {
      const key = r.date.toISOString().slice(0,10);
      map[key] = r;
    });

    const result = [];
    for (let i = daysInt - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = map[key] || {};
      result.push({
        date: key,
        a: Number(row.given || row.reads || 0),
        b: Number(row.total || row.received || row.unique_readers || 0),
      });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Top users by posts ─────────────────────────────────────────────────
router.get('/top-users', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.name, u.username, u.profile_image_url,
        COUNT(b.id) AS post_count,
        COALESCE(SUM(lc.cnt),0) AS total_likes,
        (SELECT COUNT(*) FROM followers WHERE following_id = u.id) AS followers_count
      FROM users u
      LEFT JOIN blogs b ON b.user_id = u.id
      LEFT JOIN (SELECT blog_id, COUNT(*) AS cnt FROM likes GROUP BY blog_id) lc ON lc.blog_id = b.id
      GROUP BY u.id
      ORDER BY post_count DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Top posts by likes ─────────────────────────────────────────────────
router.get('/top-posts', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT b.id, b.heading, b.sub_heading, b.created_at, b.is_public,
        u.name, u.username,
        COUNT(l.id) AS likes_count
      FROM blogs b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN likes l ON l.blog_id = b.id
      WHERE b.is_public = TRUE
      GROUP BY b.id
      ORDER BY likes_count DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Content split public vs private ───────────────────────────────────
router.get('/content-split', auth, async (req, res) => {
  try {
    const [[row]] = await db.query(`
      SELECT
        SUM(is_public = TRUE) AS public_count,
        SUM(is_public = FALSE) AS private_count,
        COUNT(*) AS total,
        AVG(likes_per_blog) AS avg_likes,
        AVG(char_len) AS avg_len,
        SUM(has_sub) / COUNT(*) * 100 AS pct_with_sub
      FROM (
        SELECT b.is_public,
          CHAR_LENGTH(b.description) AS char_len,
          b.sub_heading IS NOT NULL AS has_sub,
          COUNT(l.id) AS likes_per_blog
        FROM blogs b
        LEFT JOIN likes l ON l.blog_id = b.id
        GROUP BY b.id
      ) sub
    `);
    res.json({
      public_count:  Number(row.public_count  || 0),
      private_count: Number(row.private_count || 0),
      total:         Number(row.total         || 0),
      avg_likes:     parseFloat((row.avg_likes || 0).toFixed(1)),
      avg_len:       Math.round((row.avg_len   || 0) / 5), // rough word count
      pct_with_sub:  Math.round(row.pct_with_sub || 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Post heatmap last 12 weeks ─────────────────────────────────────────
router.get('/heatmap', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DATE(created_at) AS date, COUNT(*) AS count
      FROM blogs
      WHERE created_at >= NOW() - INTERVAL 84 DAY
      GROUP BY DATE(created_at)
    `);
    const map = {};
    rows.forEach(r => { map[r.date.toISOString().slice(0,10)] = Number(r.count); });

    const result = [];
    for (let i = 83; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, count: map[key] || 0 });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Recent activity feed ───────────────────────────────────────────────
router.get('/activity', auth, async (req, res) => {
  try {
    const [follows] = await db.query(`
      SELECT 'follow' AS type, u1.name AS actor, u1.username AS actor_username,
        u2.name AS target, u2.username AS target_username,
        f.followed_at AS ts, NULL AS extra
      FROM followers f
      JOIN users u1 ON f.follower_id = u1.id
      JOIN users u2 ON f.following_id = u2.id
      ORDER BY f.followed_at DESC LIMIT 5
    `);

    const [posts] = await db.query(`
      SELECT 'post' AS type, u.name AS actor, u.username AS actor_username,
        NULL AS target, NULL AS target_username,
        b.created_at AS ts, b.heading AS extra
      FROM blogs b JOIN users u ON b.user_id = u.id
      ORDER BY b.created_at DESC LIMIT 5
    `);

    const [likes] = await db.query(`
      SELECT 'like' AS type, u.name AS actor, u.username AS actor_username,
        bu.name AS target, bu.username AS target_username,
        l.liked_at AS ts, b.heading AS extra
      FROM likes l
      JOIN users u ON l.user_id = u.id
      JOIN blogs b ON l.blog_id = b.id
      JOIN users bu ON b.user_id = bu.id
      ORDER BY l.liked_at DESC LIMIT 5
    `);

    const [joins] = await db.query(`
      SELECT 'join' AS type, name AS actor, username AS actor_username,
        NULL AS target, NULL AS target_username,
        created_at AS ts, NULL AS extra
      FROM users ORDER BY created_at DESC LIMIT 3
    `);

    const all = [...follows, ...posts, ...likes, ...joins]
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 10);

    res.json(all);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Performance metrics ────────────────────────────────────────────────
router.get('/performance', auth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysInt = parseInt(days);

    const [[row]] = await db.query(`
      SELECT
        COUNT(DISTINCT b.id) / ? AS avg_daily_posts,
        COUNT(DISTINCT l.id) / NULLIF(COUNT(DISTINCT b.id), 0) AS engagement_rate,
        (SELECT COUNT(*) FROM followers f1
          WHERE EXISTS (SELECT 1 FROM followers f2 WHERE f2.follower_id = f1.following_id AND f2.following_id = f1.follower_id)
        ) / NULLIF((SELECT COUNT(*) FROM followers), 0) * 10 AS follow_back_ratio,
        SUM(b.is_public) / NULLIF(COUNT(b.id), 0) * 10 AS public_ratio
      FROM blogs b
      LEFT JOIN likes l ON l.blog_id = b.id
      WHERE b.created_at >= NOW() - INTERVAL ? DAY
    `, [daysInt, daysInt]);

    const [[ret]] = await db.query(`
      SELECT COUNT(DISTINCT user_id) / NULLIF((SELECT COUNT(*) FROM users), 0) * 10 AS retention
      FROM (
        SELECT user_id FROM blogs WHERE created_at >= NOW() - INTERVAL 7 DAY
        UNION SELECT user_id FROM likes WHERE liked_at >= NOW() - INTERVAL 7 DAY
      ) active
    `);

    res.json([
      { label: 'Avg daily posts',    value: Math.min(10, parseFloat((row.avg_daily_posts || 0).toFixed(1))),   max: 10 },
      { label: 'Engagement rate',    value: Math.min(10, parseFloat((row.engagement_rate || 0).toFixed(1))),   max: 10 },
      { label: 'Follow-back ratio',  value: Math.min(10, parseFloat((row.follow_back_ratio || 0).toFixed(1))), max: 10 },
      { label: 'Public post ratio',  value: Math.min(10, parseFloat((row.public_ratio || 0).toFixed(1))),      max: 10 },
      { label: 'Retention (7d)',     value: Math.min(10, parseFloat((ret.retention || 0).toFixed(1))),         max: 10 },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
