const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "local_db.json");

function generateObjectId() {
  const chars = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 24; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Initialize JSON database file
function initDb() {
  if (!fs.existsSync(DB_PATH)) {
    const hashed = bcrypt.hashSync("admin123", 10);
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({
        users: [
          {
            _id: "600000000000000000000001",
            name: "Admin",
            email: "ramsningh56812@gmail.com",
            password: hashed,
            role: "admin",
            createdAt: new Date()
          }
        ],
        orders: [],
        blocks: [],
        reports: [],
        optouts: []
      }, null, 2)
    );
    console.log("📂 Local JSON DB file initialized.");
  }
}

function readDb() {
  initDb();
  try {
    const data = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading JSON db:", err);
    return { users: [], orders: [], blocks: [], reports: [], optouts: [] };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing JSON db:", err);
  }
}

// Convert model name to collection key
function getCollectionKey(modelName) {
  const map = {
    User: "users",
    Order: "orders",
    Block: "blocks",
    Report: "reports",
    OptOut: "optouts"
  };
  return map[modelName] || modelName.toLowerCase() + "s";
}

// Simple query matcher helper
function matchQuery(item, query) {
  if (!query) return true;
  for (const [key, val] of Object.entries(query)) {
    // Nested query matching (e.g. 'sender.email')
    if (key.includes(".")) {
      const parts = key.split(".");
      let current = item;
      for (const part of parts) {
        current = current ? current[part] : undefined;
      }
      if (val instanceof RegExp) {
        if (!val.test(current)) return false;
      } else if (current !== val) {
        return false;
      }
    } else {
      // Regex support
      if (val instanceof RegExp) {
        if (!val.test(item[key])) return false;
      } else if (val && typeof val === "object" && "$in" in val) {
        // Support { $in: [...] }
        if (!val.$in.includes(item[key])) return false;
      } else if (val && typeof val === "object" && "$ne" in val) {
        // Support { $ne: ... }
        if (item[key] === val.$ne) return false;
      } else if (item[key] !== val) {
        return false;
      }
    }
  }
  return true;
}

// Override query execution methods on mongoose models
function patchMongoose() {
  console.log("⚠️ Activating Mongoose monkey-patching for local JSON database.");

  // Save implementation
  mongoose.Model.prototype.save = async function () {
    const modelName = this.constructor.modelName;
    const collectionKey = getCollectionKey(modelName);
    const db = readDb();
    
    // Create copy of data
    const obj = this.toObject();
    if (!obj._id) {
      obj._id = generateObjectId();
    }
    if (!obj.createdAt) {
      obj.createdAt = new Date().toISOString();
    }

    const index = db[collectionKey].findIndex(x => x._id === obj._id || (obj.orderId && x.orderId === obj.orderId) || (obj.pukeCode && x.pukeCode === obj.pukeCode));
    if (index > -1) {
      db[collectionKey][index] = { ...db[collectionKey][index], ...obj };
    } else {
      db[collectionKey].push(obj);
    }

    writeDb(db);
    return obj;
  };

  // Find implementations
  mongoose.Model.find = function (query) {
    const modelName = this.modelName;
    const collectionKey = getCollectionKey(modelName);
    
    const exec = () => {
      const db = readDb();
      return db[collectionKey].filter(item => matchQuery(item, query));
    };

    // Return a chainable promise object
    return {
      then: function (resolve, reject) {
        try {
          resolve(exec());
        } catch (e) {
          reject(e);
        }
      },
      sort: function (sortOpts) {
        return {
          then: function (resolve) {
            const results = exec();
            results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            resolve(results);
          }
        };
      }
    };
  };

  mongoose.Model.findOne = function (query) {
    const modelName = this.modelName;
    const collectionKey = getCollectionKey(modelName);
    
    const exec = () => {
      const db = readDb();
      const item = db[collectionKey].find(item => matchQuery(item, query));
      if (!item) return null;
      
      // Return item with save method
      const doc = new this(item);
      doc._id = item._id; // keep same ID
      return doc;
    };

    return {
      then: function (resolve, reject) {
        try {
          resolve(exec());
        } catch (e) {
          reject(e);
        }
      },
      select: function (fields) {
        return this;
      }
    };
  };

  mongoose.Model.findById = function (id) {
    return this.findOne({ _id: id });
  };

  mongoose.Model.create = async function (data) {
    const doc = new this(data);
    return await doc.save();
  };

  mongoose.Model.countDocuments = function (query) {
    const modelName = this.modelName;
    const collectionKey = getCollectionKey(modelName);
    
    const exec = () => {
      const db = readDb();
      return db[collectionKey].filter(item => matchQuery(item, query)).length;
    };

    return {
      then: function (resolve, reject) {
        try {
          resolve(exec());
        } catch (e) {
          reject(e);
        }
      }
    };
  };

  mongoose.Model.findOneAndUpdate = function (query, update, options = {}) {
    const modelName = this.modelName;
    const collectionKey = getCollectionKey(modelName);
    
    const exec = async () => {
      const db = readDb();
      let index = db[collectionKey].findIndex(item => matchQuery(item, query));
      let docData;

      if (index > -1) {
        db[collectionKey][index] = { ...db[collectionKey][index], ...update };
        docData = db[collectionKey][index];
      } else if (options.upsert) {
        docData = {
          _id: generateObjectId(),
          ...query,
          ...update,
          createdAt: new Date().toISOString()
        };
        db[collectionKey].push(docData);
      }

      writeDb(db);
      if (!docData) return null;
      const doc = new this(docData);
      doc._id = docData._id;
      return doc;
    };

    return {
      then: function (resolve, reject) {
        exec().then(resolve).catch(reject);
      }
    };
  };

  mongoose.Model.aggregate = function (pipeline) {
    const modelName = this.modelName;
    const collectionKey = getCollectionKey(modelName);
    
    const exec = () => {
      const db = readDb();
      const items = db[collectionKey];
      
      // Simple representation of grouping sum for revenue stats
      if (pipeline && pipeline.length > 0 && pipeline[0].$group) {
        const sumField = pipeline[0].$group.totalRevenue.$sum; // e.g. "$price"
        const cleanField = sumField.replace("$", "");
        
        const sum = items.reduce((acc, item) => {
          return acc + (Number(item[cleanField]) || 0);
        }, 0);

        return [{ _id: null, totalRevenue: sum }];
      }
      return [];
    };

    return {
      then: function (resolve, reject) {
        try {
          resolve(exec());
        } catch (e) {
          reject(e);
        }
      }
    };
  };
}

module.exports = {
  patchMongoose
};
