const crypto = require('crypto');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const signToken = (id, tokenVersion = 1) => {
    return jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

const createSendToken = (user, statusCode, res, extraData = {}) => {
    const token = signToken(user._id, user.tokenVersion || 1);
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
        expires: new Date(
            Date.now() + (Number(process.env.JWT_COOKIE_EXPIRES_IN) || 7) * 24 * 60 * 60 * 1000
        ),
        httpOnly: true,
        // In production the frontend (Vercel) and backend (Render) are cross-site,
        // requiring SameSite=None + Secure. In development, Lax is used.
        sameSite: isProduction ? 'None' : 'Lax',
        secure: isProduction,
        path: '/'
    };

    res.cookie('jwt', token, cookieOptions);

    // Issue anti-CSRF token in readable cookie for browser to echo in X-XSRF-TOKEN header
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('XSRF-TOKEN', csrfToken, {
        expires: cookieOptions.expires,
        httpOnly: false, // Must be readable by frontend JS to attach header
        sameSite: isProduction ? 'None' : 'Lax',
        secure: isProduction,
        path: '/'
    });

    // Remove sensitive fields from output
    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        csrfToken,
        data: {
            user,
            ...extraData
        }
    });
};

// Validate password complexity and bounds
const validatePasswordPolicy = (password) => {
    if (!password || typeof password !== 'string') {
        return 'Password is required';
    }
    if (password.length < 10) {
        return 'Password must be at least 10 characters long';
    }
    if (password.length > 128) {
        return 'Password must not exceed 128 characters';
    }
    // Must contain uppercase, lowercase, digit, and special character
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
        return 'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character';
    }
    return null;
};

exports.register = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ status: 'fail', message: 'Please provide email and password!' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(normalizedEmail) || normalizedEmail.length > 254) {
            return res.status(400).json({ status: 'fail', message: 'Please provide a valid email address!' });
        }

        const passwordError = validatePasswordPolicy(password);
        if (passwordError) {
            return res.status(400).json({ status: 'fail', message: passwordError });
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(400).json({ status: 'fail', message: 'Email already registered' });
        }

        // Create new user
        const newUser = await User.create({
            email: normalizedEmail,
            password,
            tokenVersion: 1
        });

        createSendToken(newUser, 201, res, { brokerStatus: 'NOT_CONFIGURED' });
    } catch (err) {
        console.error('[AuthController] Registration error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ status: 'fail', message: 'Please provide email and password!' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        // Query user with password
        const user = await User.findOne({ email: normalizedEmail }).select('+password');

        // Check for temporary account lockout
        if (user && user.lockUntil && user.lockUntil > Date.now()) {
            const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
            return res.status(429).json({
                status: 'fail',
                message: `Account is temporarily locked. Please try again in ${minutesLeft} minute(s).`
            });
        }

        const isPasswordCorrect = user ? await user.comparePassword(password) : false;

        if (!user || !isPasswordCorrect) {
            // Uniform login error to eliminate user account enumeration
            if (user) {
                user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
                if (user.failedLoginAttempts >= 5) {
                    user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minute lock
                    user.failedLoginAttempts = 0;
                }
                await user.save({ validateBeforeSave: false });
            }
            return res.status(401).json({ status: 'fail', message: 'Invalid email or password' });
        }

        // Reset failed login attempts on successful login
        if (user.failedLoginAttempts > 0 || user.lockUntil) {
            user.failedLoginAttempts = 0;
            user.lockUntil = undefined;
            await user.save({ validateBeforeSave: false });
        }

        // Check user's broker status
        const BrokerConnection = require('../models/BrokerConnection');
        const connection = await BrokerConnection.findOne({ userId: user._id });
        const brokerStatus = connection ? connection.sessionStatus : 'NOT_CONFIGURED';

        createSendToken(user, 200, res, { brokerStatus });
    } catch (err) {
        console.error('[AuthController] Login error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

exports.logout = async (req, res) => {
    try {
        if (req.user) {
            // Invalidate existing JWTs by incrementing tokenVersion
            await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
        }
    } catch (err) {
        console.error('[AuthController] Logout token invalidation error:', err);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const clearOptions = {
        httpOnly: true,
        sameSite: isProduction ? 'None' : 'Lax',
        secure: isProduction,
        path: '/'
    };
    res.clearCookie('jwt', clearOptions);
    res.clearCookie('XSRF-TOKEN', { ...clearOptions, httpOnly: false });
    res.status(200).json({ status: 'success' });
};

exports.protect = async (req, res, next) => {
    try {
        // 1) Extract token from Bearer header or cookies
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        } else if (req.cookies && req.cookies.jwt) {
            token = req.cookies.jwt;
        }

        if (!token) {
            return res.status(401).json({ status: 'fail', message: 'You are not logged in! Please log in to get access.' });
        }

        // 2) Verify token signature and expiration
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3) Check if user still exists
        const currentUser = await User.findById(decoded.id);
        if (!currentUser) {
            return res.status(401).json({ status: 'fail', message: 'The user belonging to this token no longer exists.' });
        }

        // 4) Check tokenVersion for server-side token revocation / logout
        const currentVersion = currentUser.tokenVersion || 1;
        const tokenVersionInJwt = decoded.tokenVersion || 1;
        if (tokenVersionInJwt !== currentVersion) {
            return res.status(401).json({ status: 'fail', message: 'Session expired or invalidated. Please log in again.' });
        }

        // Grant access to protected route
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
