const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Get my blogs
router.get('/my', auth, async (req, res) => {
  try {
    const [blogs] = await db.query(
      `SELECT b.*, u.username, u.name, u.profile_image_url,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id) AS likes_count,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id AND user_id = ?) AS liked_by_me
       FROM blogs b JOIN users u ON b.user_id = u.id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json(blogs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all public blogs (feed)
router.get('/feed', auth, async (req, res) => {
  try {
    const [blogs] = await db.query(
      `SELECT b.*, u.username, u.name, u.profile_image_url,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id) AS likes_count,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id AND user_id = ?) AS liked_by_me,
        (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = b.user_id) AS is_following
       FROM blogs b JOIN users u ON b.user_id = u.id
       WHERE b.is_public = TRUE
       ORDER BY b.created_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json(blogs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get blogs from people I follow
router.get('/following', auth, async (req, res) => {
  try {
    const [blogs] = await db.query(
      `SELECT b.*, u.username, u.name, u.profile_image_url,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id) AS likes_count,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id AND user_id = ?) AS liked_by_me,
        1 AS is_following
       FROM blogs b JOIN users u ON b.user_id = u.id
       JOIN followers f ON f.following_id = b.user_id
       WHERE f.follower_id = ? AND b.is_public = TRUE
       ORDER BY b.created_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json(blogs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single blog by id
router.get('/:id', auth, async (req, res) => {
  try {
    const [blogs] = await db.query(
      `SELECT b.*, u.username, u.name, u.profile_image_url,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id) AS likes_count,
        (SELECT COUNT(*) FROM likes WHERE blog_id = b.id AND user_id = ?) AS liked_by_me,
        (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND following_id = b.user_id) AS is_following
       FROM blogs b JOIN users u ON b.user_id = u.id
       WHERE b.id = ?`,
      [req.user.id, req.user.id, req.params.id]
    );
    if (blogs.length === 0) return res.status(404).json({ message: 'Blog not found' });
    const blog = blogs[0];
    // If private, only author can see
    if (!blog.is_public && blog.user_id !== req.user.id) {
      return res.status(403).json({ message: 'This blog is private' });
    }
    res.json(blog);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create blog
router.post('/', auth, async (req, res) => {
  try {
    const { heading, sub_heading, description, is_public } = req.body;
    if (!heading || !description) {
      return res.status(400).json({ message: 'Heading and description are required' });
    }
    const [result] = await db.query(
      'INSERT INTO blogs (user_id, heading, sub_heading, description, is_public) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, heading, sub_heading || null, description, is_public !== false]
    );
    const [blog] = await db.query(
      `SELECT b.*, u.username, u.name, u.profile_image_url,
        0 AS likes_count, 0 AS liked_by_me
       FROM blogs b JOIN users u ON b.user_id = u.id WHERE b.id = ?`,
      [result.insertId]
    );
    res.status(201).json(blog[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update blog
router.put('/:id', auth, async (req, res) => {
  try {
    const { heading, sub_heading, description, is_public } = req.body;
    const [existing] = await db.query('SELECT * FROM blogs WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Blog not found or unauthorized' });

    await db.query(
      'UPDATE blogs SET heading=?, sub_heading=?, description=?, is_public=? WHERE id=?',
      [heading, sub_heading || null, description, is_public !== false, req.params.id]
    );
    res.json({ message: 'Updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete blog
router.delete('/:id', auth, async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM blogs WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Blog not found or unauthorized' });
    await db.query('DELETE FROM blogs WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle like
router.post('/:id/like', auth, async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM likes WHERE user_id = ? AND blog_id = ?', [req.user.id, req.params.id]);
    if (existing.length > 0) {
      await db.query('DELETE FROM likes WHERE user_id = ? AND blog_id = ?', [req.user.id, req.params.id]);
      res.json({ liked: false });
    } else {
      await db.query('INSERT INTO likes (user_id, blog_id) VALUES (?, ?)', [req.user.id, req.params.id]);
      res.json({ liked: true });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
