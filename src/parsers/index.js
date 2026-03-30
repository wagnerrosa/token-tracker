"use strict";

const claude = require("./claude");
const codex = require("./codex");
const gemini = require("./gemini");
const opencode = require("./opencode");

const parsers = [claude, codex, gemini, opencode];

function getAll() {
  return parsers;
}

function getByName(name) {
  return parsers.find((p) => p.name === name) || null;
}

module.exports = { getAll, getByName };
