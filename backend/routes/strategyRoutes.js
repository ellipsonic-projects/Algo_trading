const express = require('express');
const strategyController = require('../controllers/strategyController');
const authController = require('../controllers/authController');

const router = express.Router();

router.use(authController.protect);

router.get('/count', strategyController.getStrategyCount);

module.exports = router;
