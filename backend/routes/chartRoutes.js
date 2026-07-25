const express = require('express');
const router = express.Router();
const chartController = require('../controllers/chartController');

router.get('/market-data', chartController.getMarketChartData);
router.get('/index-ltp', chartController.getIndexLtp);

module.exports = router;
