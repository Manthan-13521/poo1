/**
 * Thermal Receipt Printing Service
 * Browser-based printing — opens a popup window with 80mm-optimised HTML.
 * No printer drivers required. Works on any browser-connected thermal printer.
 */

export interface MemberReceiptData {
    poolName: string;
    memberId: string; // M0001 or MS0001
    name: string;
    age?: number;
    phone: string;
    planName: string;
    planQty: number;
    planPrice: number;
    paidAmount: number;
    balance: number;
    registeredAt: Date;
    validTill: Date;
}

function fmtDateTime(date: Date): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mon = months[d.getMonth()];
    const yr = d.getFullYear();
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${day} ${mon} ${yr} ${h}:${m} ${ampm}`;
}

function buildReceiptHTML(data: MemberReceiptData): string {
    const regDT  = fmtDateTime(data.registeredAt);
    const tillDT = fmtDateTime(data.validTill);
    const total  = `₹${data.planPrice}`;
    const bal    = `₹${data.balance > 0 ? data.balance : 0}`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Receipt — ${data.memberId}</title>
<style>
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}
@page {
    size: 80mm auto;
    margin: 0;
}
html, body {
    width: 80mm;
    margin: 0;
    padding: 0;
    font-family: 'Courier New', Courier, monospace;
    font-size: 13px;
    line-height: 1.2;
    background: #fff;
    color: #000;
}
.receipt {
    width: 100%;
    padding: 4px;
    box-sizing: border-box;
}
.c {
    text-align: center;
}
.b {
    font-weight: bold;
}
.hr {
    border-top: 1px dashed black;
    width: 100%;
    margin: 2px 0;
}
.row {
    width: 100%;
    text-align: left;
}
@media print {
    html, body {
        width: 80mm;
        margin: 0;
        padding: 0;
    }
}
</style>
</head>
<body>
<div class="receipt">
<div class="row c">SWIMMING POOL</div>
<div class="row c">(Token/Receipt)</div>
<div class="hr"></div>
<div class="row b">MID: ${data.memberId}</div>
<div class="row">Name: ${data.name}</div>
<div class="row">Phone: ${data.phone}</div>
<div class="hr"></div>
<div class="row">Plan: ${data.planName}</div>
<div class="row">QTY: ${data.planQty}</div>
<div class="hr"></div>
<div class="row b">Total: ${total}</div>
<div class="row">Balance: ${bal}</div>
<div class="hr"></div>
<div class="row">Date: ${regDT}</div>
<div class="row">ValidTill: ${tillDT}</div>
</div>
<script>
window.onload = function() {
    window.print();
    setTimeout(function() { window.close() }, 600);
}
</script>
</body>
</html>`;
}

/**
 * Opens a popup and auto-prints 80mm thermal receipt.
 * Call this on the client side after a successful member registration.
 *
 * @param data - Member receipt data
 */
export function printThermalReceipt(data: MemberReceiptData): void {
    if (typeof window === "undefined") return; // SSR guard

    const html = buildReceiptHTML(data);
    const win = window.open("", "_blank", "width=340,height=300,toolbar=0,menubar=0,scrollbars=0");

    if (!win) {
        console.warn("[ThermalPrint] Popup blocked. Please allow popups for this site.");
        return;
    }

    win.document.write(html);
    win.document.close();
    win.focus();
    // Auto-print & close handled by inline <script> in the receipt HTML
}
