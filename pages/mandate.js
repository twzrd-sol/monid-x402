(function (root) {
  "use strict";
  var HAPPY_ANSWER = "Listed at $40 and in stock at 2:14 p.m.";
  var EDGE_GAP = "Could not establish whether it is still $40 and in stock. One listing was stale and another disagreed on price and stock. Stopped inside the five-cent limit. Nothing was bought.";
  var TASK = "Check whether this item is still $40 and in stock. Spend up to five cents. Don’t buy it.";
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function contentHash(delivered) {
    var msg = new TextEncoder().encode(delivered);
    var bitLen = msg.length * 8;
    var padded = new Uint8Array((((msg.length + 9 + 63) >> 6) << 6));
    padded.set(msg);
    padded[msg.length] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
    view.setUint32(padded.length - 4, bitLen >>> 0);
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Uint32Array(64);
    for (var i = 0; i < padded.length; i += 64) {
      for (var t = 0; t < 16; t += 1) w[t] = view.getUint32(i + t * 4);
      for (t = 16; t < 64; t += 1) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (t = 0; t < 64; t += 1) {
        s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + s1 + ch + K[t] + w[t]) >>> 0;
        s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (s0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(function (x) { return x.toString(16).padStart(8, "0"); }).join("");
  }
  function recordMandate(instruction, limitUsd) {
    return { instruction: instruction, limitUsd: limitUsd, spentUsd: 0, buy: false };
  }
  function conflicted(pages) {
    if (pages.some(function (page) { return page.stale; })) return true;
    var prices = {};
    var stocks = {};
    var priceCount = 0;
    var stockCount = 0;
    pages.forEach(function (page) {
      if (page.listedUsd !== undefined && prices[String(page.listedUsd)] !== true) {
        prices[String(page.listedUsd)] = true;
        priceCount += 1;
      }
      if (page.inStock !== undefined && stocks[String(page.inStock)] !== true) {
        stocks[String(page.inStock)] = true;
        stockCount += 1;
      }
    });
    return priceCount > 1 || stockCount > 1;
  }
  function receiptFor(opened, spent) {
    if (!opened.length) return null;
    var body = opened.map(function (page) { return page.body; }).join("\n");
    var last = opened[opened.length - 1];
    return {
      source: opened.map(function (page) { return page.source; }).join(" "),
      paymentUsd: spent,
      timestamp: last.observedAt,
      contentHash: contentHash(body)
    };
  }
  function runMandate(mandate, pages) {
    var base = { mandate: mandate, approvalRequired: false, interrupted: false, purchased: false };
    var spent = mandate.spentUsd;
    var opened = [];
    for (var i = 0; i < pages.length; i += 1) {
      var page = pages[i];
      var remaining = Number((mandate.limitUsd - spent).toFixed(4));
      if (page.openPriceUsd > remaining) {
        return {
          mandate: { instruction: mandate.instruction, limitUsd: mandate.limitUsd, spentUsd: spent, buy: false },
          approvalRequired: false,
          interrupted: false,
          purchased: false,
          spentUsd: spent,
          answer: null,
          gap: "The next check costs more than the remaining budget, so it was not opened. No approval was requested.",
          receipt: receiptFor(opened, spent)
        };
      }
      spent = Number((spent + page.openPriceUsd).toFixed(4));
      opened.push(page);
    }
    var receipt = receiptFor(opened, spent);
    var recorded = { instruction: mandate.instruction, limitUsd: mandate.limitUsd, spentUsd: spent, buy: false };
    if (conflicted(opened)) {
      return Object.assign({}, base, { mandate: recorded, spentUsd: spent, answer: null, gap: EDGE_GAP, receipt: receipt });
    }
    return Object.assign({}, base, { mandate: recorded, spentUsd: spent, answer: HAPPY_ANSWER, gap: null, receipt: receipt });
  }
  var happyPage = {
    source: "https://shop.example/item/shelf",
    openPriceUsd: 0.02,
    body: "Shelf page. Price 40 USD. In stock. Checked at 2:14 p.m.",
    observedAt: "2:14 p.m.",
    listedUsd: 40,
    inStock: true
  };
  var edgePages = [
    {
      source: "https://shop.example/item/old-cache",
      openPriceUsd: 0.02,
      body: "Cached shelf. Price 40 USD. Marked in stock yesterday.",
      observedAt: "yesterday",
      listedUsd: 40,
      inStock: true,
      stale: true
    },
    {
      source: "https://shop.example/item/live",
      openPriceUsd: 0.02,
      body: "Live shelf. Price 36 USD. Out of stock.",
      observedAt: "2:16 p.m.",
      listedUsd: 36,
      inStock: false
    }
  ];
  var mandate = recordMandate(TASK, 0.05);
  var api = {
    task: TASK,
    happy: runMandate(mandate, [happyPage]),
    edge: runMandate(mandate, edgePages),
    recordMandate: recordMandate,
    runMandate: runMandate,
    contentHash: contentHash
  };
  root.MandateDemo = api;
  function text(id, value) {
    var node = root.document && root.document.getElementById(id);
    if (node) node.textContent = value;
  }
  function mount() {
    if (!root.document) return;
    text("answer", api.happy.answer);
    text("spent", "$" + api.happy.spentUsd.toFixed(2));
    text("limit", "$" + api.happy.mandate.limitUsd.toFixed(2));
    text("receipt-source", api.happy.receipt.source);
    text("receipt-payment", "$" + api.happy.receipt.paymentUsd.toFixed(2));
    text("receipt-time", api.happy.receipt.timestamp);
    text("receipt-hash", api.happy.receipt.contentHash);
    text("edge-gap", api.edge.gap);
    text("edge-spent", "$" + api.edge.spentUsd.toFixed(2));
    var stop = root.document.getElementById("show-stop");
    var edge = root.document.getElementById("edge");
    if (stop && edge) {
      stop.addEventListener("click", function () {
        edge.hidden = false;
      });
    }
  }
  if (root.document && root.document.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", mount);
  } else if (root.document) {
    mount();
  }
})(typeof window !== "undefined" ? window : globalThis);
