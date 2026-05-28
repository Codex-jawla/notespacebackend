const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer config for profile images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `user_${req.user.id}_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Get current user profile
router.get('/me', auth, async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT u.id, u.username, u.email, u.name, u.bio, u.profile_image_url, u.created_at, u.dob, u.phone_no,
        (SELECT COUNT(*) FROM followers WHERE following_id = u.id) AS followers_count,
        (SELECT COUNT(*) FROM followers WHERE follower_id = u.id) AS following_count,
        (SELECT COUNT(*) FROM blogs WHERE user_id = u.id) AS blogs_count
       FROM users u WHERE u.id = ?`,
      [req.user.id]
    );
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(users[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get any user profile
router.get('/:id', auth, async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT u.id, u.username, u.name, u.bio, u.profile_image_url, u.created_at,
        (SELECT COUNT(*) FROM followers WHERE following_id = u.id) AS followers_count,
        (SELECT COUNT(*) FROM followers WHERE follower_id = u.id) AS following_count,
        (SELECT COUNT(*) FROM blogs WHERE user_id = u.id AND is_public = TRUE) AS blogs_count,
        (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = u.id) AS is_following
       FROM users u WHERE u.id = ?`,
      [req.user.id, req.params.id]
    );
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });

    // Get public blogs for profile
    const [blogs] = await db.query(
      `SELECT b.id, b.heading, b.sub_heading, b.created_at, b.is_public,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id) AS likes_count,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id AND user_id = ?) AS liked_by_me
       FROM blogs b WHERE b.user_id = ? AND (b.is_public = TRUE OR b.user_id = ?)
       ORDER BY b.created_at DESC`,
      [req.user.id, req.params.id, req.user.id]
    );

    res.json({ ...users[0], blogs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get followers list for a user
router.get('/:id/followers', auth, async (req, res) => {
  try {
    const [followers] = await db.query(
      `SELECT u.id, u.username, u.name, u.profile_image_url,
        (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = u.id) AS is_following
       FROM followers f JOIN users u ON f.follower_id = u.id
       WHERE f.following_id = ?`,
      [req.user.id, req.params.id]
    );
    res.json(followers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get following list for a user
router.get('/:id/following', auth, async (req, res) => {
  try {
    const [following] = await db.query(
      `SELECT u.id, u.username, u.name, u.profile_image_url,
        (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = u.id) AS is_following
       FROM followers f JOIN users u ON f.following_id = u.id
       WHERE f.follower_id = ?`,
      [req.user.id, req.params.id]
    );
    res.json(following);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Follow / Unfollow user
router.post('/:id/follow', auth, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }
    const [existing] = await db.query(
      'SELECT * FROM followers WHERE follower_id = ? AND following_id = ?',
      [req.user.id, req.params.id]
    );
    if (existing.length > 0) {
      await db.query('DELETE FROM followers WHERE follower_id = ? AND following_id = ?', [req.user.id, req.params.id]);
      res.json({ following: false });
    } else {
      await db.query('INSERT INTO followers (follower_id, following_id) VALUES (?, ?)', [req.user.id, req.params.id]);
      res.json({ following: true });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update profile
router.put('/me/update', auth, async (req, res) => {
  try {
    const { name, bio, dob, phone_no } = req.body;
    await db.query(
      'UPDATE users SET name=?, bio=?, dob=?, phone_no=? WHERE id=?',
      [name || null, bio || 'none', dob || null, phone_no || null, req.user.id]
    );
    res.json({ message: 'Profile updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload profile image
router.post('/me/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const url = `/uploads/${req.file.filename}`;
    await db.query('UPDATE users SET profile_image_url=? WHERE id=?', [url, req.user.id]);
    res.json({ profile_image_url: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
