const express = require('express');
const strategyController = require('../controllers/strategyController');
const authController = require('../controllers/authController');

const router = express.Router();

router.use(authController.protect);

router.get('/', strategyController.getAllStrategies);
router.get('/count', strategyController.getStrategyCount);

// ── Condition statistics endpoints (must be before /:strategyName wildcard) ──
router.get('/manifests', strategyController.getManifests);
router.get('/stats/report', strategyController.getConditionReport);
router.post('/stats/reset', strategyController.resetConditionReport);

router.post('/:strategyName/start', strategyController.startStrategy);
router.post('/:strategyName/stop', strategyController.stopStrategy);
router.get('/:strategyName/status', strategyController.getStrategyStatus);
router.post('/:strategyName/exit', strategyController.exitStrategyPosition);

module.exports = router;
