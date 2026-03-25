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

function formatDate(date: Date): string {
    return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

function formatCurrency(amount: number): string {
    return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildReceiptHTML(data: MemberReceiptData): string {
    const dashedLine = "------------------------------------------";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Receipt — ${data.memberId}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Courier Prime', Courier, monospace;
      font-size: 11.5px;
      width: 72mm;
      padding: 0mm 4mm;
      background: white;
      color: #000;
      line-height: 1.5;
    }

    .text-line {
      font-size: 11.5px;
      text-align: center;
      margin: 4px 0;
      color: #666;
      white-space: nowrap;
      overflow: hidden;
    }

    .pool-name {
      font-size: 16px;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      margin-bottom: 8px;
      margin-top: 8px;
    }

    .member-id {
      font-size: 14px;
      text-align: center;
      margin: 4px 0;
    }

    .row {
      margin-bottom: 2px;
      padding-left: 2px;
    }
    
    .total-row {
      text-align: center;
      margin: 6px 0;
    }

    @media print {
      @page { width: 80mm; margin: 0; }
      body { width: 72mm; padding: 2mm 4mm; }
    }
  </style>
</head>
<body>
  <div class="pool-name">${data.poolName || "SWIMMING POOL"}</div>
  <div class="text-line">${dashedLine}</div>

  <div class="member-id">${data.memberId}</div>

  <div class="text-line">${dashedLine}</div>

  <div class="row">Name : ${data.name}</div>
  <div class="row">Phone : ${data.phone}</div>

  <div class="text-line">${dashedLine}</div>

  <div class="row">Plan : ${data.planName}</div>
  <div class="row">Qty : ${data.planQty} unit${data.planQty > 1 ? "s" : ""}</div>

  <div class="text-line">${dashedLine}</div>

  <div class="total-row">Total : ${formatCurrency(data.planPrice)}</div>

  <div class="text-line">${dashedLine}</div>

  <div class="row">Paid : ${formatCurrency(data.paidAmount)}</div>
  <div class="row">Balance: ${formatCurrency(data.balance > 0 ? data.balance : 0)}</div>

  <div class="text-line">${dashedLine}</div>

  <div class="row">Date : ${formatDate(data.registeredAt)} ${formatTime(data.registeredAt)}</div>
  <div class="row">Till : ${formatDate(data.validTill)} ${formatTime(data.validTill)}</div>

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
    const win = window.open("", "_blank", "width=340,height=400,toolbar=0,menubar=0,scrollbars=1");

    if (!win) {
        console.warn("[ThermalPrint] Popup blocked. Please allow popups for this site.");
        return;
    }

    win.document.write(html);
    win.document.close();
    win.focus();

    // Small delay lets fonts/styles load before printing
    setTimeout(() => {
        win.print();
        win.close();
    }, 400);
}
