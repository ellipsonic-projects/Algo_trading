const express = require('express');
const router = express.Router();
const chartController = require('../controllers/chartController');
const authController = require('../controllers/authController');

// Issue #5 FIX: all chart routes are now authenticated.
// req.user is populated by protect middleware, required by chartController to scope overlays.
router.use(authController.protect);

router.get('/market-data', chartController.getMarketChartData);
router.get('/index-ltp', chartController.getIndexLtp);
router.get('/margins', chartController.getMargins);

module.exports = router;
