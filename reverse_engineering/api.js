'use strict';

const elasticsearch = require('elasticsearch');
const fs = require('fs');

module.exports = {
	connect: function(connectionInfo, logger, cb){
		logger.clear();
		let clientParams = {};
		let authString = "";

		if (connectionInfo.username) {
			authString = connectionInfo.username;
		}

		if (connectionInfo.password) {
			authString += ':' + connectionInfo.password;
		}

		if (connectionInfo.connectionType === 'Direct connection') {
			clientParams.host = {
				protocol: connectionInfo.protocol,
				host: connectionInfo.host,
				port: connectionInfo.port,
				path: connectionInfo.path,
				auth: authString
			};
		} else if (connectionInfo.connectionType === 'Replica set or Sharded cluster') {
			clientParams.hosts = connectionInfo.hosts.map(socket => {
				return {
					host: socket.host,
					port: socket.port,
					protocol: connectionInfo.protocol,
					auth: authString
				};
			});
		} else {
			cb('Invalid connection parameters');
		}

		if (connectionInfo.is_ssl) {
			clientParams.ssl = {
				ca: fs.readFileSync(connectionInfo.ca),
				rejectUnauthorized: connectionInfo.rejectUnauthorized
			};
		}

		logger.log('info', clientParams);
		let connection = new elasticsearch.Client(clientParams);

		cb(null, connection);
	},

	disconnect: function(connectionInfo, logger, cb){
		cb()
	},

	testConnection: function(connectionInfo, logger, cb){
		this.connect(connectionInfo, logger, (err, connection) => {
			if (err) {
				cb(err);
			} else {
				connection.ping({
					requestTimeout: 5000
				}, (error, success) => {
					if (error) {
						logger.log('error', error, 'Test connection', connectionInfo.hiddenKeys);
					}
					cb(!success);
				});
			}
		});
	},

	getDatabases: function(connectionInfo, logger, cb){
		cb();
	},

	getDocumentKinds: function(connectionInfo, logger, cb) {
		cb();
	},

	getDbCollectionsNames: function(connectionInfo, logger, cb) {
		this.connect(connectionInfo, logger, (err, client) => {
			if (err) {
				logger.log('error', err);
				cb(err);
				return;
			}
			
			const { includeSystemCollection } = connectionInfo;

			client.indices.getMapping()
				.then(data => {
					let result = [];

					for (let index in data) {
						if (!includeSystemCollection && index[0] === '.') {
							continue;
						}

						let dbItem = {
							dbName: index,
							dbCollections: []
						};

						if (data[index].mappings) {
							dbItem.dbCollections = Object.keys(data[index].mappings);
						}

						result.push(dbItem);
					}

					cb(null, result);
				})
				.catch(err => {
					logger.log('error', err);
					cb(err);
				});
		});
	},

	getDbCollectionsData: function(data, logger, cb){
		let includeEmptyCollection = data.includeEmptyCollection;
		let { recordSamplingSettings, fieldInference } = data;
		let bucketList = data.collectionData.dataBaseNames;
		
		logger.log('info', getSamplingInfo(recordSamplingSettings, fieldInference), 'Reverse-Engineering sampling params', data.hiddenKeys);
		logger.log('info', { CollectionList: bucketList }, 'Selected collection list', data.hiddenKeys);

		this.connect(data, logger, (err, client) => {
			client.info().then(info => {
				let modelInfo = {
					name: info.name,
					host: data.host,
					port: +data.port,
					dbVersion: [ info.version.number ]
				};
			});

			cb(null, data);
		});
	}
};

function getSamplingInfo(recordSamplingSettings, fieldInference){
	let samplingInfo = {};
	let value = recordSamplingSettings[recordSamplingSettings.active].value;
	let unit = (recordSamplingSettings.active === 'relative') ? '%' : ' records max';
	
	samplingInfo.recordSampling = `${recordSamplingSettings.active} ${value}${unit}`
	samplingInfo.fieldInference = (fieldInference.active === 'field') ? 'keep field order' : 'alphabetical order';
	
	return samplingInfo;
}
