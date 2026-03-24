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
    const dashedLine = "--------------------------------";
    const doubleLine = "================================";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Receipt — ${data.memberId}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Courier Prime', 'Courier New', Courier, monospace;
      font-size: 7px;
      width: 36mm;
      padding: 2mm;
      background: white;
      color: #000;
    }

    .center { text-align: center; }
    .bold { font-weight: bold; }
    
    .text-line {
      font-size: 7px;
      letter-spacing: 0.25px;
      text-align: center;
      margin: 1px 0;
      white-space: pre;
    }

    .pool-name {
      font-size: 9px;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    .receipt-title {
      font-size: 6.5px;
      text-align: center;
      margin-bottom: 2px;
      letter-spacing: 0.5px;
    }

    table { width: 100%; border-collapse: collapse; margin: 2px 0; }
    td { padding: 1px 0; vertical-align: top; }
    td:first-child { width: 42%; color: #444; }
    td:last-child { font-weight: 500; font-size: 7.5px; }

    .balance-row td { color: #cc0000; font-weight: bold; }
    .footer { text-align: center; margin-top: 3px; font-size: 6.5px; }
    .member-id {
      font-size: 10px;
      font-weight: bold;
      text-align: center;
      letter-spacing: 1.5px;
      margin: 3px 0;
    }

    @media print {
      @page { width: 40mm; margin: 0; }
      body { width: 36mm; padding: 2mm; }
    }
  </style>
</head>
<body>
  <div class="pool-name">${data.poolName}</div>
  <div class="receipt-title">TOKEN / RECEIPT</div>
  <div class="text-line">${doubleLine}</div>

  <table>
    <tr><td>Name</td><td>: ${data.name}</td></tr>
    <tr><td>Phone</td><td>: ${data.phone}</td></tr>
  </table>

  <div class="text-line">${dashedLine}</div>

  <table>
    <tr><td>Plan</td><td>: ${data.planName}</td></tr>
    <tr><td>Qty</td><td>: <span class="bold">${data.planQty} unit${data.planQty > 1 ? "s" : ""}</span></td></tr>
    <tr><td>Total Price</td><td>: ${formatCurrency(data.planPrice)}</td></tr>
  </table>

  <div class="text-line">${dashedLine}</div>

  <table>
    <tr><td>Paid</td><td>: ${formatCurrency(data.paidAmount)}</td></tr>
    ${data.balance > 0 ? `<tr class="balance-row"><td>Balance</td><td>: ${formatCurrency(data.balance)}</td></tr>` : '<tr><td>Balance</td><td>: Nil</td></tr>'}
  </table>

  <div class="text-line">${dashedLine}</div>

  <table>
    <tr><td>Date</td><td>: ${formatDate(data.registeredAt)}</td></tr>
    <tr><td>Time</td><td>: ${formatTime(data.registeredAt)}</td></tr>
    <tr><td>Valid Till</td><td>: ${formatDate(data.validTill)}<br>&nbsp;&nbsp;${formatTime(data.validTill)}</td></tr>
  </table>

  <div class="text-line">${dashedLine}</div>

  <div class="member-id">${data.memberId}</div>

  <div class="text-line">${doubleLine}</div>
  <br />
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
    const win = window.open("", "_blank", "width=170,height=310,toolbar=0,menubar=0,scrollbars=1");

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
