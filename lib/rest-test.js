'use strict';

/*globals beforeEach, afterEach, describe, it*/
/*jshint camelcase:false */

var debug = require('debug')('rest-test');
var expect = require('chai').expect;
var supertest = require('supertest');
var _ = require('lodash');
var q = require('q');

/**
 * Constructor for a test case for a RESTful API
 * @param {String} description   A description for the test case
 * @param {RestTest} parent      The parent for this test case
 * @param {string|fn} app         The url for the api to be tested or the application itself
 * @param {Object} options      A hash of options for the test case
 */
function RestTest(description, parent, app, options){
	description = description || 'Testing RESTFul API';

	this.authSchemes  = {};

	this.description = {description:description, value: description};
	this.parent = parent;
	this.app = app;
	this.options = options || {};

	this.children = [];
	this.expectations = [];
}

RestTest.prototype = {
	/**
	 * Starts the Specification of a child a test case. Makes the current test case a Suite.
	 * @param  {[type]} description A description of the test case
	 * @return {Object}             A new new child test case
	 */
	toEnsure: function(description){
		var child = new RestTest(description, this, this.app, this.options);
		this.children.push(child);
		return child;
	},

	/**
	 * Configures an auth scheme to be used in this test case.
	 * @param  {string|object} key  Key or object map of authorization schemes
	 * @param  {object} value       the authorization scheme
	 * @return {object}             The current test case
	 */
	useAuthScheme: function(key, value){
		if(typeof key === 'object'){
			this.authSchemes = _.assign(this.authSchemes, key);
		}
		else{
			this.authSchemes[key] = value;
		}

		return this;
	},

	/**
	 * Specifies the resource to be tested
	 * @param  {String} description A description of the resource
	 * @param  {String} resourcePath  The relative path to the resource
	 * @return {Object}               The current test case.
	 */
	useResource: function(description, resourcePath){
		if(this.parent && this.parent.resource){
			throw new Error('You cannot test a different resource in a child test');
		}
		else{
			if(!resourcePath){
				resourcePath = description;
			}
			this.resource = {description: description, value: resourcePath};
		}

		return this;
	},

	/**
	 * Specifies the method to be used for the test
	 * @param  {String} description A description for the operation that uses the method
	 * @param  {String} method      The HTTP method to be used.
	 * @return {Object}             The current test case
	 */
	useMethod: function(description, method){
		if(this.parent && this.parent.method){
			throw new Error('You cannot use a different method in a child test');
		}
		else{
			if(!method){
				method = description;
			}
			if(method.toLowerCase() === 'delete'){method = 'del';}
			this.method = {description: description, value: method};
		}
			
		return this;
	},

	/**
	 * Maps credentials to keys for later reference in useCredentials
	 * @param  {string|object} key  Key or object has of credentials
	 * @param  {object} value       the credentials
	 * @return {object}             The current test case
	 */
	mapCredentials: function(key, value){
		if(typeof key === 'object'){
			this.credentialsMap = key;
		}
		else{
			this.credentialsMap = this.credentialsMap || {};
			this.credentialsMap[key] = value;
		}

		return this;
	},

	/**
	 * Specifies the credentials to be used for the test
	 * If only a string description is specified, the test tree is searched upwards for
	 * a credential with a matching description
	 * @param  {string|object} description      string description credential object
	 * @param  {object} credentials             object hash of credentials
	 * @param  {string} type                    The type of credential
	 * @return {object}                     The current test case.
	 */
	useCredentials: function(description, credentials){
		if(typeof description === 'object'){
			credentials = description;
			description = Date.now();
		}
		else if(typeof description === 'string' && !credentials){
			credentials = (this._getCredential(description)||{});
		}

		if(!credentials){
			throw new Error('Invalid parameter: credentials could not be deduced');
		}

		this.credentials = {description: description, value: credentials};

		return this;
	},

	_getCredential: function(key){
		var creds = (this.credentialsMap || {})[key];
		if(creds){
			return creds;
		}
		else if(this.parent){
			return this.parent._getCredential(key);
		}
		else{
			return undefined;
		}
	},

	/**
	 * Specifies that no credentials should be used for the test
	 * @return {Object}               The current test case.
	 */
	withoutCredentials: function(){
		this.credentials = {__removed:true};
		return this;
	},

	/**
	 * Specifies the combination of parameters to be used for the test
	 * @param  {string|object} type the type of parameter to be set, or an object literal representing all parameters
	 * @param  {string|object} key A string for the parameter key to be set, or an object representing the parameters of that type
	 * @param  {ANY} value Any value.
	 * @return {Object}        The current test case
	 */
	useParams: function(type, key, value){
		if(typeof type === 'object'){
			this.params = _.chain(type)
				.pick(['path', 'header', 'query', 'body', 'form'])
				.transform(function(a, v, k){
					a[k] = _.transform(v, function(a1, v1, k1){
						a1[k1] = {key:k1, value:v1};
					}, {});
				}, {})
				.valueOf();
		}
		else if (typeof type === 'string'){
			if(!/path|header|query|body|form/){
				throw new Error('Invalid Argument: "type" must be one of path, header, query, body or form');
			}

			this.params = this.params || {};
			if(typeof key === 'object'){
				this.params[type] = _.transform(key, function(a1, v1, k1){
					a1[k1] = {key:k1, value:v1};
				}, {});
			}
			else if( typeof key === 'string'){
				this.params[type] = this.params[type] || {};
				this.params[type][key] = {key:key, value:value};
			}
			else{
				throw new Error('Invalid Argument: "Key" must be a string or object');
			}
		}
		else{
			throw new Error('Invalid argument: "type" must be a string or object');
		}

		return this;
	},

	/**
	 * Specifies that some or all paramaters should not be used for the test
	 * If no parameters are supplied then all parameters are disabled
	 * @param  {String} type the type of parameters to remove.
	 * @param  {String} key  the key of parameter to remove.
	 * @return {Object}        The current test case
	 */
	withoutParams: function(type, key){
		if(!type && !key){
			this.params = {__removed:true};
		}
		else if(type && !key) {
			this.params = this.params || {};
			this.params[type] = {__removed:true};
		}
		else if(type && key){
			this.params = this.params || {};
			this.params[type] = this.params[type] || {};
			this.params[type][key] = {__removed:true};
		}
		
		return this;
	},

	/**
	 * Specifies path parameters
	 * @param  {string|object} key   the key for the value or a hash of keys and values.
	 * @param  {ANY} value The value for the given key
	 * @return {Object}       The current test case.
	 */
	usePathParams: function(key, value){
		return this.useParams('path', key, value);
	},

	useHeader: function(key, value){
		return this.useParams('header', key, value);
	},

	useQuery: function(key, value){
		return this.useParams('query', key, value);
	},

	useBody: function(key, value){
		return this.useParams('body', key, value);
	},

	/**
	 * Creates an expectation for the response.
	 * @param  {number|string| Object|function} key a number for status, string for header, object for body or function to check the response. 
	 * @param  {any} value -valid if key is a string. Specifies the expected value for a header
	 * @return {Object} The current test case
	 */
	expect: function(key, value){
		var self = this;
		if(typeof key === 'number'){
			self.expectStatus(key);
		}
		else if(typeof key === 'string'){
			self.expectHeader(key, value);
		}
		else if(typeof key === 'object'){
			self.expectBody(key);
		}
		else if( typeof key === 'function'){
			self.expectResponse(key);
		}
		else{
			throw new Error('invalid specification of expectation');
		}

		return this;
	},
	expectStatus: function(status){
		var self = this;
		self.expectations.push(function(res, next){
			expect(res.status).to.equal(status);
			return next();
		});
		return self;
	},
	expectHeader: function(name, value){
		var self = this;
		self.expectations.push(function(res, next){
			expect(res.header).to.have.property(name, value);
			return next();
		});
		return self;
	},
	expectBody: function(body){
		var self = this;
		self.expectations.push(function(res, next){
			expect(res.body).to.match(body);
			return next();
		});
		return self;
	},
	expectResponse: function(fn){
		var self = this;
		self.expectations.push(fn);
		return self;
	},
	expectArrayOfLength: function(n, status){
		var self = this;
		self.expectations.push(function(res, next){
			if(status){
				expect(res.status).to.equal(status);
			}
			expect(res.body).to.have.length(n);
			return next();
		});
		return self;
	},
	expectArrayWithMemberFields: function(fields){
		var self = this;
		self.expectations.push(function(res, next){
			_.forEach(res.body, function(m){
				expect(_.chain(m).omit(fields).keys().valueOf()).to.have.length(0);
			});
			return next();
		});
		return self;
	},
	/**
	 * Signifies that the specification of the current test case is complete.
	 * This should be called as many times as is required to close the top-most test case
	 * @return {Object} The parent test case or the current test case if there is no parent.
	 */
	done: function(){
		var self = this;
		if(self.children.length === 0 && self.expectations.length === 0){
			throw new Error('Terminal Test cases must have at least one expectation');
		}

		if(!self.parent){
			self._specify()();
		}

		return self.parent || self;
	},
	
	_specify: function(groupKeys){
		var self = this;

		if(!groupKeys){
			groupKeys = _.filter(['resource', 'method'], function(k){
				return typeof self[k] !== 'undefined';
			});
			return function(){
				debug('Specifying Test: %s', self.description.value);
				describe(self.description.value, self._specify(groupKeys));
			};
		}
		
		if(groupKeys.length > 0){
			debug('Specifying for group: %s', _.head(groupKeys));
			return function(){
				describe(self[_.head(groupKeys)].description, self._specify(_.tail(groupKeys)));
			};
		}
		else{
			//var authCache = {};

			return function(){
				if(!self.parent){
					beforeEach(function(){
						this.restTest = {};
						this.restTest.app = self.app;
						this.restTest.options = self.options;
					});
				}

				beforeEach(function(){
					debug('Synthesizing test case');
					var restTest = this.restTest;
					// _.forEach(['resource', 'method'], function(k){
					// 	if(typeof self[k] !== 'undefined'){
					// 		restTest[k] = self[k].value;
					// 	}
					// });
					
					if(self.resource){
						debug('Setting resource for %s', self.description.value, self.resource.value);
						restTest.resource = self.resource.value;
					}

					if(self.method){
						debug('Setting method for %s', self.description.value, self.method.value);
						restTest.method = self.method.value;
					}
					//merge authSchemes
					debug('Merging authSchemes for ' + self.description.value, self.authSchemes, restTest.authSchemes);
					restTest.authSchemes = _.assign(restTest.authSchemes || {}, self.authSchemes||{});
					
					if(self.authorization){
						restTest.authorization = restTest.authorization || {};
						restTest.authorization = self.authorization.value;
					}

					debug('Choosing Credentials for ' + self.description.value, self.credentials);

					if(self.credentials && self.credentials.__removed){
						restTest.credentials = null;
					}
					else{
						restTest.credentials = self.credentials? self.credentials.value : restTest.credentials;
					}
					
					
					restTest.params = restTest.params || {};
					if(self.params){
						restTest.params = _.merge(restTest.params, self.params || {}, function(rtValue, oValue){
							if (oValue && oValue.__removed){return null;}
							else {return undefined;}
						});
					}

					restTest.expectations =  restTest.expectations || [];
					restTest.expectations =  restTest.expectations.concat(self.expectations);
				});

				afterEach(function(){
					this.restTest.expectations = [];
				});
					
				if(self.children.length > 0){
					_.forEach(self.children, function(child){
						debug('Specifying Child %s', child.description.value);
						child._specify()();
					});
				}
				else{
					debug('specifying beforeEach for it');
					beforeEach(function(done){
						var rt = this.restTest;
						var authFn = rt.credentials && self._authentication[rt.credentials.type];
						if(authFn){
							debug('Using Credentials for ' + self.description.value, rt.credentials);
							return authFn.bind(rt)(rt.app, rt.authSchemes[rt.credentials.type], rt.credentials, rt, done);
						}
						else{
							debug('No Valid Credentials for ' + self.description.value);
							done();
						}
					});

					
					debug('specifying it');
					it(self.description.value, function(done){
						debug('Running Test "%s" with %s expectations', self.description.value, this.restTest.expectations.length);
						
						var rt = this.restTest;
						
						var url = rt.resource;
						if(rt.params.path && !rt.params.path.__removed){
							_.forEach((rt.params || {}).path || {}, function(p){
								if(p.__removed){return;}
								url = url.replace('{'+p.key+'}', p.value);
							});
						}
							
						var request = supertest(rt.app)[rt.method.toLowerCase()](url);

						request.set('Accept', 'application/json');
						
						if(rt.authorizationHeader){
							request.set('Authorization', rt.authorizationHeader);
						}

						_.forEach((rt.params || {}).header || {}, function(p){
							debug('Setting header %s', p.key);
							if(p.__removed){return;}
							request.set(p.key, p.value);
						});

						if(rt.params.query && !rt.params.query.__removed){
							var queryArgs = _.reduce(rt.params.query, function(a, p){
								if(p.__removed){return a;}
								a[p.key] = p.value;
								return a;
							}, {});
							debug('Configuring query', queryArgs);
							request.query(queryArgs);
						}
						
						if(rt.params.body && !rt.params.body.__removed){
							debug('Configuring body');
							request.send(_.reduce(rt.params.body, function(a, p){
								if(p.__removed){return a;}
								a[p.key] = p.value;
								return a;
							}, {}));
						}

						request.end(function(err, res){
							debug('Request Returned');
							if(err){return done(err);}

							function next(stack, err){
								debug('Checking expectations');
								if(!stack || stack.length ===0){
									debug('No expectation was violated');
									return done();
								}
								else if(err){
									debug('An expectation has been violated');
									return done(err);
								}
								_.head(stack).bind(rt)(res, _.partial(next, _.tail(stack)));
								// try{
								// 	_.head(res, _.partial(next, _.tail(stack)));
								// }
								// catch(ex){
								// 	debug('Error checking expectation', ex);
								// 	return done(ex);
								// }
								
							}
							next(rt.expectations);
						});
					});
				}
			};
		}
	},
	_authentication:{
		oauth2: function(app, authScheme, credentials, restTest, done){
			if(authScheme.grantTypes.password){
				q()
				.then(function(){
					var userCredentials = credentials.user;
					var clientCredentials = credentials.client;

					if(credentials.accessToken){
						debug('accessToken retrieved from cache ', credentials.accessToken);
						return credentials.accessToken;
					}
					else{
						debug('Retrieving accessToken');
						var tokenEndpoint = authScheme.grantTypes.password.tokenEndpoint;

						
						
						var clientAuthHeader = 'Basic ' +
							(new Buffer(clientCredentials.id+':'+clientCredentials.secret).toString('base64'));
						
						var tokenRequest = supertest(app)
							.post(tokenEndpoint.url)
							.send(_.assign({grant_type:'password'}, userCredentials))
							.set('Authorization', clientAuthHeader)
							.set('Accept', 'application/json')
							.expect(200);
						return q.ninvoke(tokenRequest, 'end')
						.then(function(res){
							expect(res.body).to.have.property(tokenEndpoint.tokenName);
							var accessToken = res.body[tokenEndpoint.tokenName];
							debug('caching accessToken for %s', userCredentials.username, accessToken);
							credentials.accessToken = accessToken;
							return credentials.accessToken;
						});
					}
					
				})
				.then(function(accessToken){
					var authorizationHeader = 'Bearer ' + accessToken;
					restTest.authorizationHeader = authorizationHeader;
					debug('Set authorization header %s', authorizationHeader);
					done();
				})
				.fail(function(err){
					debug('An Error occured whilst configuring authorization', err);
					return done(err);
				})
				.done();
			}
			else{
				debug('Unsupported oauth grant');
				var err = new Error('Unsupported oauth grant');
				done(err);
			}
		},
		httpBasic: function(app, authScheme, credentials, restTest, done){
			var authorizationHeader = 'Basic ' +
							(new Buffer(credentials.username+':'+credentials.password).toString('base64'));
			restTest.authorizationHeader = authorizationHeader;
			debug('Set authorization header %s', authorizationHeader);
			done();
		}
	}
};

module.exports = function(app, options){
	return new RestTest(null, null, app, options);
};