import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./markdown.tsx";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown (the safe subset the copilot renders, #39)", () => {
  it("plain text is one paragraph", () => expect(html("Alice has 21.")).toBe("<p>Alice has 21.</p>"));

  it("a blank line starts a new paragraph; a single newline is a line break", () =>
    expect(html("First line\nsecond line\n\nNext paragraph")).toBe("<p>First line<br/>second line</p><p>Next paragraph</p>"));

  it("bold, italic and inline code", () =>
    expect(html("**One memo** has *instructions* in `remittance_memo`, __twice__ and _once_."))
      .toBe("<p><strong>One memo</strong> has <em>instructions</em> in <code>remittance_memo</code>, " +
            "<strong>twice</strong> and <em>once</em>.</p>"));

  it("leaves tool names, arithmetic and stray markers alone", () => {
    expect(html("Called list_customer_contacts and mark_invoice_paid.")).toBe("<p>Called list_customer_contacts and mark_invoice_paid.</p>");
    expect(html("2 * 3 * 4 = 24")).toBe("<p>2 * 3 * 4 = 24</p>");
    expect(html("A **half-written")).toBe("<p>A **half-written</p>");  // mid-stream: shown as is until it closes
  });

  it("a bullet list with bold labels, and a nested list (the run-through's reply)", () =>
    expect(html([
      "**The other memos say very little.**",
      "",
      "- **\"Inv payment, thanks\"** (10 payments):",
      "  - Evergreen Robotics Group, $641.68",
      "  - Lakeshore Farms Group, $1,650.45",
      "- **\"ACH transfer\"** (6 payments):",
      "  - Granite Glassworks Inc, $856.15",
    ].join("\n"))).toBe(
      "<p><strong>The other memos say very little.</strong></p>" +
      "<ul><li><strong>&quot;Inv payment, thanks&quot;</strong> (10 payments):" +
        "<ul><li>Evergreen Robotics Group, $641.68</li><li>Lakeshore Farms Group, $1,650.45</li></ul></li>" +
      "<li><strong>&quot;ACH transfer&quot;</strong> (6 payments):<ul><li>Granite Glassworks Inc, $856.15</li></ul></li></ul>"));

  it("a list straight after a paragraph line, and * or + as markers", () =>
    expect(html("To go further, I need one of these:\n* An invoice number.\n+ A customer ID."))
      .toBe("<p>To go further, I need one of these:</p><ul><li>An invoice number.</li><li>A customer ID.</li></ul>"));

  it("a numbered list keeps its first number", () =>
    expect(html("3. Third\n4. Fourth")).toBe('<ol start="3"><li>Third</li><li>Fourth</li></ol>'));

  it("a list item that wraps onto an indented line stays one item", () =>
    expect(html("- An invoice number. I can look up\n  the invoice.")).toBe("<ul><li>An invoice number. I can look up the invoice.</li></ul>"));

  it("headings show as bold paragraphs", () =>
    expect(html("### Summary\nAll good.")).toBe("<p><strong>Summary</strong></p><p>All good.</p>"));

  it("a fenced code block is shown verbatim", () =>
    expect(html("```sql\nselect * from invoices;\n**not bold**\n```")).toBe("<pre><code>select * from invoices;\n**not bold**</code></pre>"));

  it("a rule", () => expect(html("Above\n\n---\n\nBelow")).toBe("<p>Above</p><hr/><p>Below</p>"));

  // Short data cells (invoice numbers, dates, amounts) never wrap; longer text and headers wrap at spaces (class nw).
  it("a table, as Claude wrote one for Bob's four invoices, with inline formatting in cells", () =>
    expect(html([
      "4 invoices are more than a year overdue:",
      "",
      "| Invoice | Customer | Amount |",
      "|---|---|---|",
      "| BWS-2026-2731 | **Sterling Motors Group** | USD 740.56 |",
      "| BWS-2026-1400 | Harbor Marine LLC | USD 101.16 |",
      "",
      "The total is USD 841.72.",
    ].join("\n"))).toBe(
      "<p>4 invoices are more than a year overdue:</p>" +
      '<table><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th></tr></thead><tbody>' +
      '<tr><td class="nw">BWS-2026-2731</td><td><strong>Sterling Motors Group</strong></td><td class="nw">USD 740.56</td></tr>' +
      '<tr><td class="nw">BWS-2026-1400</td><td>Harbor Marine LLC</td><td class="nw">USD 101.16</td></tr></tbody></table>' +
      "<p>The total is USD 841.72.</p>"));

  it("table columns keep their alignment, rows are padded or cut to the header, and \\| is a literal pipe", () =>
    expect(html("Payer | Amount\n:--- | ---:\nA \\| B | 5\nC")).toBe(
      '<table><thead><tr><th style="text-align:left">Payer</th><th style="text-align:right">Amount</th></tr></thead><tbody>' +
      '<tr><td class="nw" style="text-align:left">A | B</td><td class="nw" style="text-align:right">5</td></tr>' +
      '<tr><td class="nw" style="text-align:left">C</td><td class="nw" style="text-align:right"></td></tr></tbody></table>'));

  it("a long single word (a payment ID) wraps like long text, so a table of payments fits the panel", () =>
    expect(html("| Payment ID | Amount |\n|---|---|\n| b96fb2c7-23bd-375a-9953-dcf5c949ab42 | 2096.08 EUR |")).toBe(
      "<table><thead><tr><th>Payment ID</th><th>Amount</th></tr></thead><tbody>" +
      '<tr><td>b96fb2c7-23bd-375a-9953-dcf5c949ab42</td><td class="nw">2096.08 EUR</td></tr></tbody></table>'));

  it("a separator with a different number of columns isn't a table (a sentence with a pipe, then a rule)", () =>
    expect(html("Paid | unpaid split is 3 to 1\n---")).toBe("<p>Paid | unpaid split is 3 to 1</p><hr/>"));

  it("a line with pipes but no separator under it stays text", () =>
    expect(html("a | b\nnot a separator")).toBe("<p>a | b<br/>not a separator</p>"));

  it("table cells are escaped like everything else", () =>
    expect(html("| x |\n|---|\n| <img src=x onerror=alert(1)> |")).toBe(
      '<table><thead><tr><th>x</th></tr></thead><tbody><tr><td>&lt;img src=x onerror=alert(1)&gt;</td></tr></tbody></table>'));

  it("never turns the reply into markup beyond the subset: HTML is escaped, links stay text", () => {
    expect(html('Memo: <b>pay now</b> <img src=x onerror="alert(1)">'))
      .toBe("<p>Memo: &lt;b&gt;pay now&lt;/b&gt; &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
    expect(html("[click](javascript:alert(1)) and <https://evil.example>"))
      .toBe("<p>[click](javascript:alert(1)) and &lt;https://evil.example&gt;</p>");
    expect(html("**<script>x</script>**")).toBe("<p><strong>&lt;script&gt;x&lt;/script&gt;</strong></p>");
  });

  it("empty text renders nothing", () => expect(html("")).toBe(""));
});
