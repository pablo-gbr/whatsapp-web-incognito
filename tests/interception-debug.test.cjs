const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function load(context, file)
{
    const filename = path.join(__dirname, "..", file);
    vm.runInContext(readFileSync(filename, "utf8"), context, { filename });
}

test("startup names the script that failed and stops loading its dependants", async () =>
{
    const logs = [];
    const scripts = [];
    const context = vm.createContext({
        console: { info: (...args) => logs.push(args) },
        chrome: { runtime: { getURL: file => file } },
        performance: { now: () => 0 },
        document: {
            readyState: "loading",
            head: { appendChild: script => scripts.push(script) },
            createElement: () => ({ setAttribute(name) { this.marker = name; }, remove() {} })
        }
    });
    load(context, "core_injection.js");
    assert.equal(scripts[0].src, "core/ws_hook.js");
    assert.equal(scripts[0].marker, "data-wa-incognito-debug");
    await scripts[0].onload();
    assert.equal(scripts[1].src, "core/comms_worker_fix.js");
    scripts[1].onerror();
    await new Promise(setImmediate);
    assert.equal(scripts.length, 2);
    assert.match(JSON.stringify(logs), /injection stopped","core\/comms_worker_fix\.js failed to load/);
});

test("interception diagnostics report silent fallback and later success without printing frame data", async () =>
{
    const logs = [];
    const events = [];
    const listeners = new Map();
    const context = vm.createContext({
        console: { info: (...args) => logs.push(args), log() {} },
        document: {
            currentScript: { hasAttribute: name => name === "data-wa-incognito-debug" },
            addEventListener: (name, listener) => listeners.set(name, listener),
            dispatchEvent: event => events.push(event.type)
        },
        CustomEvent: class { constructor(type) { this.type = type; } },
        indexedDB: { open: () => ({}) },
        WebSocket: class {},
        setTimeout() {}
    });
    vm.runInContext("window = globalThis", context);
    load(context, "core/ws_hook.js");
    assert.equal(context.WAIncognitoInterceptionReport().outgoingHandlerInstalled, false);
    vm.runInContext(`
        MultiDevice = {
            enqueuePromise: (callback, data) => callback(data),
            decryptNoisePacket: async () => { throw "wrong counter for a private frame"; }
        };
        packet = new Uint8Array([99, 120]);
    `, context);
    load(context, "core/interception.js");

    assert.equal(await context.wsHook.before(context.packet), context.packet);
    assert.equal(await context.wsHook.before(context.packet), context.packet);
    listeners.get("onInterceptionDebugSnapshot")();
    const report = context.WAIncognitoInterceptionReport();
    assert.equal(report.webSocketHookActive, true);
    assert.equal(report.outgoingHandlerInstalled, true);
    assert.equal(report.incomingHandlerInstalled, true);
    assert.equal(report.stages["outgoing fallback at decrypt"], 2);
    assert.equal(logs.filter(([, stage]) => stage === "outgoing fallback at decrypt").length, 1);
    assert.match(JSON.stringify(logs), /Noise counter mismatch/);
    assert.doesNotMatch(JSON.stringify(logs), /private frame|99,120/);
    assert.deepEqual(events, []);

    context.MultiDevice.decryptNoisePacket = async () => [];
    context.MultiDevice.encryptAndPackNodesForSending = async () => context.packet;
    context.isEqualArray = () => true;
    await context.wsHook.before(context.packet);
    await context.wsHook.before(context.packet);
    assert.deepEqual(events, ["onInterceptionWorking"]);
    assert.equal(context.WAIncognitoInterceptionReport().stages["page dispatching onInterceptionWorking"], 1);
    context.WAdebugEnabled = false;
    const logCount = logs.length;
    listeners.get("onInterceptionDebugSnapshot")();
    await context.wsHook.before(context.packet);
    assert.equal(logs.length, logCount);
});
