'use strict';

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('jsonld'));
  } else {
    root.hydra = factory(root.jsonld);
  }
})(this, function (jsonld) {

  var hydra = {};

  var jsonldp = jsonld.promises();

  var ns = {
    hydra: {
      apiDocumentation: 'http://www.w3.org/ns/hydra/core#apiDocumentation'
    },
    rdfs: {
      comment: 'http://www.w3.org/2000/01/rdf-schema#comment',
      label: 'http://www.w3.org/2000/01/rdf-schema#label',
      range: 'http://www.w3.org/2000/01/rdf-schema#range'
    }
  };

  var utils = hydra.utils = {};

  utils.finder = function (array, property) {
    property = property || 'iri';

    return function (key) {
      if (property === 'iri') {
        key = utils.iri(key);
      }

      return array
        .filter(function (item) {
          return item[property] === key;
        })
        .shift();
    };
  };

  utils.iri = function (obj) {
    obj = utils.unwrap(obj);

    if (!obj) {
      return undefined;
    }

    if (typeof obj === 'string') {
      return obj;
    }

    if (!('@id' in obj)) {
      return undefined;
    }

    return obj['@id'];
  };

  utils.toArray = function (obj) {
    if (!obj) {
      return [];
    }

    if (!Array.isArray(obj)) {
      return [obj];
    }

    return obj;
  };

  utils.unwrap = function (obj) {
    if (!obj) {
      return undefined;
    }

    if (typeof obj === 'string') {
      return obj;
    }

    if ('@graph' in obj) {
      obj = obj['@graph'];
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return undefined;
      } else {
        obj = obj[0];
      }
    }

    return obj;
  };

  utils.values = function (array) {
    if (!array) {
      return undefined;
    }

    return Object.keys(array).map(function (key) {
      return array[key];
    });
  };

  if (typeof XMLHttpRequest !== 'undefined') {
    hydra.requestAsync = function (method, requestUrl, headers, content, callback) {
      var xhr = new XMLHttpRequest();

      xhr.onreadystatechange = function () {
        if (xhr.readyState === xhr.DONE) {
          var
            headerLines = xhr.getAllResponseHeaders().split('\r\n'),
            resHeaders = {};

          for (var i = 0; i < headerLines.length; i++) {
            var headerLine = headerLines[i].split(': ', 2);
            resHeaders[headerLine[0].toLowerCase()] = headerLine[1];
          }

          callback(xhr.status, resHeaders, xhr.responseText);
        }
      };

      xhr.open(method, requestUrl, true);

      for (var header in headers) {
        xhr.setRequestHeader(header, headers[header]);
      }

      xhr.send(content);
    };
  } else {
    hydra.requestAsync = function (method, requestUrl, headers, content, callback, options) {
      var
        http = require('http'),
        https = require('https'),
        url = require('url');

      var
        reqOptions = url.parse(requestUrl),
        client = http;

      reqOptions.hash = null;
      reqOptions.method = method;
      reqOptions.headers = headers;

      if (reqOptions.protocol === 'https:') {
        client = https;
      }

      if (options && options.user && options.password) {
        reqOptions.auth = options.user + ':' + options.password;
      }

      var req = client.request(reqOptions, function (res) {
        var resContent = '';

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
          resContent += chunk;
        });

        res.on('end', function () {
          callback(res.statusCode, res.headers, resContent);
        });
      });

      req.on('error', function (error) { callback(null, null, null, error); });

      if (content != null) {
        req.write(content);
      }

      req.end();
    };
  }


  hydra.request = function (method, url, reqHeaders, reqBody, options) {
    return new Promise(function (resolve, reject) {
      hydra.requestAsync(method, url, reqHeaders, reqBody, function (status, resHeaders, resBody, error) {
        var response = {
          status: status,
          headers: resHeaders,
          body: resBody
        };

        if (error) {
          reject(error);
        } else if (status >= 400) {
          reject(new Error('status code: ' + status));
        } else {
          resolve(response);
        }
      }, options);
    });
  };


  hydra.api = function (json, base) {
    if (typeof json === 'string') {
      json = JSON.parse(json);
    }

    return jsonldp.expand(json, {base: base})
      .then(function (compact) {
        return (new hydra.Api(compact)).init();
      });
  };


  hydra.document = function (api, json, base) {
    if (typeof json === 'string') {
      json = JSON.parse(json);
    }

    return jsonldp.expand(json, {base: base})
      .then(function (compact) {
        return (new hydra.Document(api, compact, base)).init();
      });
  };

  hydra.load = function (apiDef, documentDef) {
    return hydra.api(apiDef)
      .then(function (api) {
        return hydra.document(api, documentDef);
      });
  };

  hydra.loadUrl = function (url) {
    var documentDef;

    return hydra.request('GET', url)
      .then(function (response) {
        documentDef = response.body;

        if (!('link' in response.headers)) {
          throw 'link header field missing';
        }

        var rels = jsonld.parseLinkHeader(response.headers.link);

        if (!(ns.hydra.apiDocumentation in rels)) {
          throw 'api documentation link missing';
        }

        var apiUrl = rels[ns.hydra.apiDocumentation].target;

        return hydra.request('GET', apiUrl)
          .then(function (response) {
            return hydra.api(response.body, apiUrl);
          })
          .then(function (api) {
            api.url = apiUrl;

            return api;
          });
      })
      .then(function (api) {
        return hydra.document(api, documentDef, url);
      })
      .then(function (document) {
        document.url = url;

        return document;
      });
  };

  hydra.Api = function (def) {
    var self = this;

    this.iri = utils.iri(def);

    this.init = function () {
      var classFrameDef = {
        '@context': {
          '@vocab': 'http://www.w3.org/ns/hydra/core#',
          'label': ns.rdfs.label
        },
        '@type': 'Class'
      };

      var operationFrameDef = {
        '@context': {
          '@vocab': 'http://www.w3.org/ns/hydra/core#',
          'label': ns.rdfs.label
        },
        '@type': 'Operation'
      };

      return Promise.all([
        jsonldp.frame(def, classFrameDef)
          .then(function (classDef) {
            self.classDef = classDef;
          }),
        jsonldp.frame(def, operationFrameDef)
          .then(function (operationDef) {
            self.operationDef = operationDef;
          })])
        .then(function () {
          var inits = [];

          self.classes = self.classDef['@graph'].map(function (def) {
            var instance = new hydra.Class(self, def);

            inits.push(instance.init());

            return instance;
          });

          self.findClass = utils.finder(self.classes);

          self.operations = self.operationDef['@graph'].map(function (def) {
            var instance = new hydra.Operation(self, def);

            inits.push(instance.init());

            return instance;
          });

          self.findOperation = utils.finder(self.operations);

          return Promise.all(inits)
            .then(function () {
              return self;
            });
        });
    };
  };

  hydra.Document = function (api, def, base) {
    var self = this;

    this.api = api;
    this.iri = utils.iri(def);
    this.base = base;

    this.init = function () {
      return Promise.resolve()
        .then(function () {
          def = utils.unwrap(def);

          if (!('@type' in def)) {
            return Promise.reject('type missing');
          }

          self.classes = utils.values(def['@type'])
            .map(function (type) {
              var abstractClass = self.api.findClass(type);

              return new hydra.ClassDocument(self, abstractClass, self.base);
            })
            .filter(function (documentClass) {
              return !!documentClass;
            });

          self.properties = Object.keys(def)
            .map(function (property) {
              if (property.indexOf('@') === 0) {
                return null;
              }

              var abstractProperty = self.classes
                .map(function (documentClass) {
                  return documentClass.findProperty(property);
                })
                .shift();

              if (!abstractProperty) {
                return null;
              }

              return new hydra.PropertyDocument(self, abstractProperty, def[property], self.base);
            })
            .filter(function (property) {
              return !!property;
            });

          self.findProperty = utils.finder(self.properties);

          self.findOperation = function() {
            if (arguments.length === 1) {
              var method = arguments[0];

              return self.classes
                .map(function (documentClass) {
                  return documentClass.findOperation(method);
                })
                .shift();
            } else {
              var iri = arguments[0];
              var method = arguments[1];

              var documentProperty = self.findProperty(iri);

              if (!documentProperty) {
                return undefined;
              }

              return documentProperty.findOperation(method);
            }
          };

          return self;
        });
    };
  };

  hydra.Class = function (api, def) {
    var self = this;

    this.api = api;
    this.iri = def['@id'];
    this.label = def.label;

    this.init = function () {
      return Promise.resolve()
        .then(function () {
          self.operations = utils.toArray(def.supportedOperation).map(function (operationDef) {
            return self.api.findOperation(operationDef['@id']);
          });

          self.findOperation = utils.finder(self.operations, 'method');

          self.properties = utils.toArray(def.supportedProperty).map(function (propertyDef) {
            return new hydra.Property(self.api, propertyDef);
          });

          self.findProperty = utils.finder(self.properties);

          return self;
        });
    };

    this.validate = function (object) {
      return jsonldp.expand(object)
        .then(function (expanded) {
          if (expanded.length > 1) {
            return 'object contains multiple subjects';
          }

          expanded = expanded.shift();

          if (!('@type' in expanded)) {
            return '@type missing';
          }

          if (utils.toArray(expanded['@type']).indexOf(self.iri) < 0) {
            return 'expected class <' + self.iri + '>';
          }

          var error = self.properties
            .map(function (property) {
              if (property.readonly && property.iri in object) {
                return 'readonly property <' + property.iri + '> filled with value "' + object[property.iri] + '"';
              }

              return false;
            })
            .filter(function (error) {
              return !!error;
            })
            .shift();

          if (error) {
            return error;
          }

          return false;
        });
    };
  };

  hydra.ClassDocument = function (document, abstract, base) {
    this.document = document;
    this.iri = abstract.iri;
    this.abstract = abstract;
    this.base = base || '';
    this.label = this.abstract.label;
    this.operations = abstract.operations.map(function (operation) {
      return new hydra.OperationDocument(document, operation, null, base);
    });
    this.properties = abstract.properties.map(function (property) {
      return new hydra.PropertyDocument(document, property,  null, base);
    });

    this.findOperation = utils.finder(this.operations, 'method');

    this.findProperty = utils.finder(this.properties);
  };

  hydra.Operation = function (api, def) {
    var self = this;

    this.api = api;
    this.iri = def['@id'];
    this.label = def.label;

    this.init = function () {
      return Promise.resolve()
        .then(function () {
          self.method = def.method;
          self.statusCodes = def.statusCodes;
          self.expects = self.api.findClass(def.expects);
          self.returns = self.api.findClass(def.returns);

          return self;
        });
    };
  };

  hydra.OperationDocument = function (document, abstract, def, base) {
    var self = this;

    this.document = document;
    this.iri = abstract.iri;
    this.abstract = abstract;
    this.link = !!def ? utils.iri(def) : '';
    this.base = base || '';
    this.label = this.abstract.label;
    this.method = this.abstract.method;
    this.statusCodes = this.abstract.statusCodes;
    this.expects = this.abstract.expects;
    this.returns = this.abstract.returns;

    this.invoke = function (content, options) {
      var validate = Promise.resolve();

      if (self.expects) {
        validate = self.expects.validate(content);
      }

      return validate
        .then(function (error) {
          if (error) {
            return Promise.reject(new Error(error));
          }

          var url = self.link || self.base;

          var headers = {
            'Accept': 'application/ld+json'
          };

          if (self.method === 'POST' || self.method === 'PUT') {
            headers['Content-Type'] = 'application/ld+json';
          }

          return hydra.request(self.method, url, headers, JSON.stringify(content), options);
        })
        .then(function (response) {
          if (response.body && response.body.trim() !== '') {
            return JSON.parse(response.body);
          } else {
            return null;
          }
        });
    };
  };

  hydra.Property = function (api, def) {
    var self = this;

    this.api = api;
    this.iri = utils.iri(def.property);
    this.title = def.title;
    this.description = def.description;
    this.label = def.label;
    this.readonly = def.readonly;
    this.writeonly = def.writeonly;
    this.operations = utils.toArray(def.property.supportedOperation)
      .map(function (operationDef) {
        return self.api.findOperation(utils.iri(operationDef));
      });

    this.findOperation = utils.finder(this.operations, 'method');
  };

  hydra.PropertyDocument = function (document, abstract, def, base) {
    this.document = document;
    this.iri = abstract.iri;
    this.abstract = abstract;
    this.link = !!def ? utils.iri(def) : '';
    this.base = base;
    this.label = this.abstract.label;
    this.operations = abstract.operations.map(function (operation) {
      return new hydra.OperationDocument(document, operation, def, base);
    });

    this.findOperation = utils.finder(this.operations, 'method');
  };

  return hydra;
});
