// Static markup only. Runtime metadata must be assigned through textContent.
export const shield = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.1 3 7.5 7.5 9.5 4.5-2 7.5-5.4 7.5-9.5V6L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m8.5 11.5 2.4 2.4 4.7-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const panelTemplate = `<section class="rp-panel" id="riskproof-panel" role="region" aria-label="当前对话安全概览" hidden>
    <div class="rp-head"><div><div class="rp-eyebrow">RISKPROOF / LIVE</div><h2 class="rp-title">当前对话安全概览</h2></div><button class="rp-close" aria-label="收起安全概览">×</button></div>
    <div class="rp-status-row"><div class="rp-status"></div><button class="rp-retry" hidden>重新连接</button></div><div class="rp-data">
    <p class="rp-scope"></p>
    <div class="rp-overview"><div class="rp-ring" role="img"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="51" stroke="var(--rp-line)"/><g class="rp-segments"></g></svg><div class="rp-total"><strong>0</strong><span>已检查调用</span></div></div><div class="rp-legend"></div></div>
    <div class="rp-section-label"><span class="rp-activity-label">调用活动</span><small class="rp-activity-limit">最近 24 次</small></div><div class="rp-activity" role="img"></div>
    <div class="rp-section-label"><span class="rp-risks-label">最近风险</span><small class="rp-risk-count"></small></div><div class="rp-risks"></div>
    <details class="rp-health" hidden><summary><span class="rp-health-label">防护检查</span><small class="rp-health-count"></small></summary><ul class="rp-checks"></ul><p class="rp-health-note"></p></details>
    <div class="rp-notice" hidden></div><p class="rp-footnote"></p></div>
    <details class="rp-details" hidden><summary>查看本次命令输出</summary><pre></pre></details>
    </section><button class="rp-beacon" aria-label="RiskProof 当前对话安全状态" aria-controls="riskproof-panel" aria-expanded="false"><span class="rp-orb">${shield}</span><span class="rp-brand"><strong>RiskProof</strong><small aria-live="polite"></small></span><span class="rp-dot"></span></button>`;
