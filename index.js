require('dotenv').config();
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const saltRounds = 12;

const port = process.env.PORT || 3000;
const app = express();
const Joi = require("joi");

const expireTime = 24 * 60 * 60 * 1000; //expires after 1 day  (hours * minutes * seconds * millis)

/* secret information section */
const mongodb_host = process.env.MONGODB_HOST;
const mongodb_user = process.env.MONGODB_USER;
const mongodb_password = process.env.MONGODB_PASSWORD;
const mongodb_database = process.env.MONGODB_DATABASE;
const mongodb_session_secret = process.env.MONGODB_SESSION_SECRET;
const node_session_secret = process.env.NODE_SESSION_SECRET;
/* END secret section */

var {database} = require('./databaseConnection');

const userCollection = database.db(mongodb_database).collection('users');

app.set('view engine', 'ejs');

app.use(express.urlencoded({extended: false}));

var mongoStore = MongoStore.create({
	mongoUrl: `mongodb+srv://${mongodb_user}:${mongodb_password}@${mongodb_host}/sessions`,
	crypto: {
		secret: mongodb_session_secret
	}
})

app.use(session({ 
    secret: node_session_secret,
	store: mongoStore, //default is memory store 
	saveUninitialized: false, 
	resave: true,
	cookie: { maxAge: expireTime } 
}
));

function isValidSession(req) {
    if (req.session.authenticated) {
        return true;
    }
    return false;
}

function sessionValidation(req,res,next) {
    if (isValidSession(req)) {
        next();
    }
    else {
        res.redirect('/login');
    }
}

function isAdmin(req) {
    if (req.session.user_type == 'admin') {
        return true;
    }
    return false;
}

function adminAuthorization(req, res, next) {
    if (!isAdmin(req)) {
        res.status(403);
        res.render("errorMessage", {error: "Not Authorized"});
        return;
    }
    else {
        next();
    }
}

app.get('/', (req, res) => {
	if (isValidSession(req)){
	res.render("main", { user: { username: req.session.username } });
	} else {
		res.render("index")
	}
});


app.get('/nosql-injection', async (req,res) => {
	var username = req.query.user;

	if (!username) {
		res.send(`<h3>no user provided - try /nosql-injection?user=name</h3> <h3>or /nosql-injection?user[$ne]=name</h3>`);
		return;
	}
	console.log("user: "+username);

	const schema = Joi.string().max(20).required();
	const validationResult = schema.validate(username);

	//If we didn't use Joi to validate and check for a valid URL parameter below
	// we could run our userCollection.find and it would be possible to attack.
	// A URL parameter of user[$ne]=name would get executed as a MongoDB command
	// and may result in revealing information about all users or a successful
	// login without knowing the correct password.
	if (validationResult.error != null) {  
	   console.log(validationResult.error);
	   res.send("<h1 style='color:darkred;'>A NoSQL injection attack was detected!!</h1>");
	   return;
	}	

	const result = await userCollection.find({username: username}).project({username: 1, password: 1, _id: 1}).toArray();

    res.send(`<h1>Hello ${username}</h1>`);
});

app.get('/about', (req,res) => {
    var color = req.query.color;
    res.render("about", {color: color});
});

app.get('/contact', (req,res) => {
    var missingEmail = req.query.missing;
    res.render("contact", {missing: missingEmail});
});

app.post('/submitEmail', (req,res) => {
    var email = req.body.email;
    if (!email) {
        res.redirect('/contact?missing=1');
    }
    else {
        res.render("submitEmail", {email: email});
    }
});

app.post('/submitUser', async (req,res) => {
	var email = req.body.email;
	var username = req.body.username;
    var password = req.body.password;
	var user = "user";

	const schema = Joi.object(
		{
			username: Joi.string().alphanum().max(20).required(),
			email: Joi.string().max(20).required(),
			password: Joi.string().max(20).required()
		});
	
	const validationResult = schema.validate({username, email, password});
	if (validationResult.error != null) {
	   console.log(validationResult.error);
	   res.redirect("/createUser");
	   return;
   }

    var hashedPassword = await bcrypt.hash(password, saltRounds);
	
	await userCollection.insertOne({username: username, email: email, password: hashedPassword, user_type: user});
	console.log("Inserted user");
    res.render("submitUser");
});

app.get('/createUser', (req,res) => {
	res.render("createUser");
});

app.get('/login', (req,res) => {
	res.render("login");
});

app.post('/loggingin', async (req,res) => {
    var email = req.body.email;
    var password = req.body.password;

	const schema = Joi.string().max(20).required();
	const validationResult = schema.validate(email);
	if (validationResult.error != null) {
	   console.log(validationResult.error);
	   res.redirect("/login");
	   return;
	}

	const result = await userCollection.find({email: email}).project({email: 1, password: 1, _id: 1, username: 1, user_type: 1}).toArray();

	console.log(result);
	if (result.length != 1) {
		console.log("user not found");
		res.redirect("/login");
		return;
	}
	if (await bcrypt.compare(password, result[0].password)) {
		console.log("correct password");
		req.session.authenticated = true;
		req.session.email = email;
		req.session.cookie.maxAge = expireTime;
		req.session.username = result[0].username;
		req.session.user_type = result[0].user_type;
		console.log(req.session.user_type);
		res.redirect('/');
		return;
	}
	else {
		console.log("incorrect password");
		res.redirect("/login");
		return;
	}
});

app.use('/loggedin', sessionValidation);
app.get('/loggedin', (req,res) => {
    if (!req.session.authenticated) {
        res.redirect('/login');
    }
    res.render("loggedin");
});

app.get('/loggedin/info', (req,res) => {
    res.render("loggedin-info");
});

app.get('/members', sessionValidation, (req, res) => {
    res.render("cat");
});
app.post('/promote', sessionValidation, adminAuthorization, async (req, res) => {
  const username = req.body.username;
  await userCollection.updateOne({ username: username }, { $set: { user_type: 'admin' } });
  res.redirect('/admin');
});

app.post('/demote', sessionValidation, adminAuthorization, async (req, res) => {
  const username = req.body.username;
  await userCollection.updateOne({ username: username }, { $set: { user_type: 'user' } });
  res.redirect('/admin');
});

app.get('/admin', sessionValidation, adminAuthorization, async (req,res) => {
	const isAdmin = req.session.user_type === 'admin';
    const result = await userCollection.find().project({username: 1, _id: 1}).toArray();
    res.render("admin", {users: result,  isAdmin: isAdmin });
});

app.get('/logout', (req,res) => {
	req.session.destroy();
    res.render("loggedout");
});

app.use(express.static(__dirname + "/public"));

app.use((req, res) => {
	res.status(404);
	res.render("404");
});


app.listen(port, () => {
	console.log("Node application listening on port "+port);
}); 