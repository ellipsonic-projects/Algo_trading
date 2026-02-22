const express = require('express');
const tradeController = require('../controllers/tradeController');
const authController = require('../controllers/authController');

const router = express.Router();

router.use(authController.protect); // All trade routes are protected

router.post('/record', tradeController.recordTrade);
router.post('/update-exit', tradeController.updateTradeExit);
router.get('/latest-open', tradeController.getLatestOpenTrade);
router.get('/', tradeController.getAllTrades);
router.get('/stats', tradeController.getStats);

module.exports = router;
