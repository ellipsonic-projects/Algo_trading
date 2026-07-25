const express = require('express');
const strategyController = require('../controllers/strategyController');
const authController = require('../controllers/authController');

const router = express.Router();

router.use(authController.protect);

router.get('/', strategyController.getAllStrategies);
router.get('/count', strategyController.getStrategyCount);

router.post('/:strategyName/start', strategyController.startStrategy);
router.post('/:strategyName/stop', strategyController.stopStrategy);
router.get('/:strategyName/status', strategyController.getStrategyStatus);
router.post('/:strategyName/exit', strategyController.exitStrategyPosition);

module.exports = router;
