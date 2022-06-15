var atomicalgolia = require("atomic-algolia")
var indexName = "net4fungr"
var indexPath = "../public/index.json"
var cb = function(error, result) {
    if (error) throw error

    console.log(result)
}

atomicalgolia(indexName, indexPath, cb)