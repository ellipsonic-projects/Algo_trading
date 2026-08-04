const User = require('../models/User');
const jwt = require('jsonwebtoken');

const signToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
};

const createSendToken = (user, statusCode, res, extraData = {}) => {
    const token = signToken(user._id);
    const cookieOptions = {
        expires: new Date(
            Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
        ),
        httpOnly: true,
        // Issue #8 FIX: SameSite:'Strict' prevents the cookie from being sent
        // on cross-site requests, blocking CSRF attacks.
        sameSite: 'Strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
    };

    res.cookie('jwt', token, cookieOptions);

    // Remove password from output
    user.password = undefined;

    // Issue #8 FIX: Do NOT return the token in the JSON body.
    // Credentials are delivered exclusively via the HttpOnly cookie.
    // Returning it in the body would allow client-side JS (and XSS) to read it.
    res.status(statusCode).json({
        status: 'success',
        data: {
            user,
            ...extraData
        }
    });
};

exports.register = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ status: 'fail', message: 'Please provide email and password!' });
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ status: 'fail', message: 'Email already registered' });
        }

        // Create new user
        const newUser = await User.create({
            email,
            password
        });

        // A new user has no broker profile yet
        createSendToken(newUser, 201, res, { brokerStatus: 'NOT_CONFIGURED' });
    } catch (err) {
        console.error('[AuthController] Registration error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // 1) Check if email and password exist
        if (!email || !password) {
            return res.status(400).json({ status: 'fail', message: 'Please provide email and password!' });
        }

        // 2) Check if user exists && password is correct
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({ status: 'fail', message: 'User does not exist' });
        }

        if (!(await user.comparePassword(password))) {
            return res.status(401).json({ status: 'fail', message: 'Incorrect password' });
        }

        // 3) Check user's broker status
        const BrokerConnection = require('../models/BrokerConnection');
        const connection = await BrokerConnection.findOne({ userId: user._id });
        const brokerStatus = connection ? connection.sessionStatus : 'NOT_CONFIGURED';

        // 4) If everything ok, send token to client with broker status
        createSendToken(user, 200, res, { brokerStatus });
    } catch (err) {
        // Issue #18 FIX: Do not leak internal error details (stack traces,
        // field names, Mongoose messages) to the caller. Log them server-side.
        console.error('[AuthController] Login error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.logout = (req, res) => {
    // IMPORTANT: clearCookie options MUST exactly match the options used when the cookie
    // was set (in createSendToken). A mismatched sameSite/secure causes the browser to
    // treat it as a different cookie and NOT clear it.
    res.clearCookie('jwt', {
        httpOnly: true,
        sameSite: 'Strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
    });
    res.status(200).json({ status: 'success' });
};

exports.protect = async (req, res, next) => {
    try {
        // 1) Getting token and check of it's there
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies && req.cookies.jwt) {
            token = req.cookies.jwt;
        }

        if (!token) {
            return res.status(401).json({ status: 'fail', message: 'You are not logged in! Please log in to get access.' });
        }

        // 2) Verification token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3) Check if user still exists
        const currentUser = await User.findById(decoded.id);
        if (!currentUser) {
            return res.status(401).json({ status: 'fail', message: 'The user belonging to this token does no longer exist.' });
        }

        // GRANT ACCESS TO PROTECTED ROUTE
        req.user = currentUser;
        next();
    } catch (err) {
        res.status(401).json({ status: 'fail', message: 'Invalid token or session expired.' });
    }
};

exports.getMe = (req, res) => {
    res.status(200).json({
        status: 'success',
        data: {
            user: req.user
        }
    });
};
