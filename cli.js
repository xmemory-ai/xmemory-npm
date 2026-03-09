#!/usr/bin/env node

const greet = require("./index");

const name = process.argv[2];
console.log(greet(name));
