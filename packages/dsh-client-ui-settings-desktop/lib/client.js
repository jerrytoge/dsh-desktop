window.__ModuleLoader__.load({
  id: "@local/dsh-client-ui-settings-desktop",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useEffect = React.useEffect;
    var useMemo = React.useMemo;
    var useState = React.useState;

    var css = `
      .dshd{width:100%;max-width:820px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:16px}
      .dshd *{box-sizing:border-box}.dshd-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.dshd h2,.dshd h3,.dshd p{margin:0}.dshd h2{font-size:18px}.dshd-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px;margin-top:5px!important}.dshd-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dshd-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);padding:9px 12px;border-bottom:2px solid transparent;cursor:pointer}.dshd-tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}
      .dshd-bar{display:flex;gap:8px;justify-content:space-between}.dshd-input{flex:1;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);height:36px;border-radius:8px;padding:0 11px;outline:none}.dshd-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);height:36px;border-radius:8px;padding:0 12px;cursor:pointer}.dshd-btn:hover{border-color:var(--dsw-alias-border-l1)}.dshd-btn:disabled{opacity:.5;cursor:default}.dshd-primary{background:var(--dsw-alias-state-business-primary);color:white;border-color:transparent}.dshd-danger{color:var(--dsw-alias-state-error-primary)}
      .dshd-note,.dshd-empty{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:13px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}.dshd-restart{display:flex;align-items:center;justify-content:space-between;gap:10px;border-color:#766127;background:color-mix(in srgb,#a77c18 12%,transparent)}.dshd-cards{display:flex;flex-direction:column;gap:9px}.dshd-card{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:14px}.dshd-title{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600}.dshd-desc{margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.dshd-tag{font-size:10px;font-weight:400;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:2px 6px;color:var(--dsw-alias-label-tertiary)}.dshd-update{color:#d7a43a}.dshd-meta{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;display:flex;gap:12px;flex-wrap:wrap}.dshd-actions{display:flex;gap:8px;align-items:center}.dshd-switch{position:relative;width:34px;height:20px;display:inline-flex;flex:none}.dshd-switch input{position:absolute;opacity:0;pointer-events:none}.dshd-slider{width:34px;height:20px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;transition:.16s}.dshd-slider:after{content:"";display:block;width:14px;height:14px;margin:2px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:.16s}.dshd-switch input:checked+.dshd-slider{background:var(--dsw-alias-state-business-primary);border-color:transparent}.dshd-switch input:checked+.dshd-slider:after{transform:translateX(14px);background:white}.dshd-switch input:disabled+.dshd-slider{opacity:.45;cursor:default}.dshd-error{color:var(--dsw-alias-state-error-primary);font-size:12px}.dshd-log{max-height:180px;overflow:auto;white-space:pre-wrap;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:10px;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary)}.dshd-command{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}.dshd-command-main{padding:16px}.dshd-row{display:grid;grid-template-columns:130px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2);font-size:12px}.dshd-row label{color:var(--dsw-alias-label-tertiary)}.dshd-row code{overflow-wrap:anywhere}.dshd-command-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l2)}
      .dshd-policy{display:flex;flex-direction:column;gap:12px}.dshd-policy-row{display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:14px}.dshd-select{min-width:150px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);height:36px;border-radius:8px;padding:0 10px;outline:none}
      .dshd-log-wrap{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:stretch;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;overflow:hidden}.dshd-log-state{appearance:none;border:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);padding:0;cursor:pointer;font-size:13px}.dshd-log-state[data-state=running]{color:var(--dsw-alias-state-business-primary)}.dshd-log-state[data-state=succeeded]{color:#55a66f}.dshd-log-state[data-state=failed]{color:var(--dsw-alias-state-error-primary)}.dshd-log-line{min-width:0;height:30px;overflow:auto hidden;white-space:nowrap;padding:7px 9px;font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}.dshd-log-wrap[data-expanded=true] .dshd-log-line{height:auto;max-height:180px;overflow:auto;white-space:pre-wrap}
    `;
    if (!document.querySelector('style[data-plugin-css="dsh-desktop-settings"]')) { var style = document.createElement("style"); style.dataset.pluginCss = "dsh-desktop-settings"; style.textContent = css; document.head.appendChild(style); }

    function unwrap(result) { if (!result || !result.ok) throw new Error(result && result.error ? result.error.message : "Desktop API unavailable"); return result.value; }
    var updateCache=null,updateCacheAt=0,updatePromise=null,UPDATE_TTL=10*60*1000;
    function updateMap(data){var map={};(data&&data.plugins||[]).forEach(p=>map[p.packageName]=p);return map}
    async function fetchUpdates(api,force){
      if(!api)return null;
      if(!force&&updateCache&&Date.now()-updateCacheAt<UPDATE_TTL)return updateCache;
      if(updatePromise)return updatePromise;
      updatePromise=api.checkUpdates().then(unwrap).then(data=>{updateCache=data;updateCacheAt=Date.now();return data}).finally(()=>{updatePromise=null});
      return updatePromise;
    }
    function invalidateUpdates(){updateCache=null;updateCacheAt=0}
    function shortRev(rev){return rev?String(rev).slice(0,7):null}
    // Start silently when the Desktop client plugin loads, before the user opens this section.
    var backgroundApi=window.dshDesktop&&window.dshDesktop.plugins;
    if(backgroundApi)setTimeout(()=>fetchUpdates(backgroundApi,false).catch(()=>{}),0);
    function OperationLog(props) {
      var [expanded,setExpanded]=useState(false);
      if (!props.operation) return null;
      var lines=(props.operation.lines||[]).map(line=>line.text).filter(Boolean);
      var text=expanded?lines.join("\n"):(lines[lines.length-1]||"正在准备操作…");
      var state=props.operation.state||"running";
      var failed=state==="failed"||state==="error";
      var icon=state==="running"?"◌":failed?"!":"✓";
      var label=state==="running"?"操作进行中":failed?"操作失败":"操作成功";
      return h("div",{className:"dshd-log-wrap","data-expanded":expanded},h("button",{type:"button",className:"dshd-log-state","data-state":failed?"failed":state,title:label+(expanded?"，点击收起日志":"，点击展开日志"),"aria-label":label+(expanded?"，收起日志":"，展开日志"),"aria-expanded":expanded,onClick:()=>setExpanded(!expanded)},icon),h("div",{className:"dshd-log-line"},text));
    }
    function PersonalPlugins() {
      var api = window.dshDesktop && window.dshDesktop.plugins;
      var [snapshot,setSnapshot]=useState(updateCache),[updates,setUpdates]=useState(updateCache?updateMap(updateCache):{}),[busy,setBusy]=useState(false),[checking,setChecking]=useState(!updateCache),[error,setError]=useState(""),[spec,setSpec]=useState(""),[operation,setOperation]=useState(null),[restart,setRestart]=useState(false);
      var load = async()=>{if(!api)return;setError("");try{setSnapshot(unwrap(await api.list()))}catch(e){setError(e.message)}};
      useEffect(()=>{var active=true;if(!api)return;load();setChecking(true);fetchUpdates(api,false).then(data=>{if(!active||!data)return;setUpdates(updateMap(data));setSnapshot(data)}).catch(()=>{}).finally(()=>{if(active)setChecking(false)});return()=>{active=false}},[]);
      useEffect(()=>{if(!operation||operation.state!=="running")return;var timer=setInterval(async()=>{try{var next=unwrap(await api.operation(operation.id));setOperation({...next});if(next.state!=="running"){clearInterval(timer);setBusy(false);if(next.state==="succeeded"){invalidateUpdates();setRestart(Boolean(next.result&&next.result.restartRequired));setChecking(true);try{var data=await fetchUpdates(api,true);setUpdates(updateMap(data));setSnapshot(data)}catch(e){await load()}finally{setChecking(false)}}else setError(next.error&&next.error.message||"操作失败")}}catch(e){clearInterval(timer);setBusy(false);setError(e.message)}},450);return()=>clearInterval(timer)},[operation&&operation.id,operation&&operation.state]);
      var run=async(start)=>{setBusy(true);setError("");try{setOperation(unwrap(await start()))}catch(e){setBusy(false);setError(e.message)}};
      var check=async()=>{setBusy(true);setChecking(true);setError("");try{var data=await fetchUpdates(api,true);setUpdates(updateMap(data));setSnapshot(data)}catch(e){setError(e.message)}finally{setBusy(false);setChecking(false)}};
      var toggle=async(plugin,enabled)=>{setBusy(true);setError("");try{var result=unwrap(await api.setEnabled(plugin.packageName,enabled));setSnapshot(result.snapshot);setRestart(Boolean(result.restartRequired)||restart)}catch(e){setError(e.message)}finally{setBusy(false)}};
      if(!api)return h("div",{className:"dshd-empty"},"此页面只能在 DeepSeek Harness Desktop 中使用。");
      var plugins=snapshot&&snapshot.plugins||[];
      return h(React.Fragment,null,
        restart&&h("div",{className:"dshd-note dshd-restart"},h("span",null,"个人插件已变更，需要重启 sidecar 后生效。"),h("button",{className:"dshd-btn dshd-primary",onClick:async()=>{setBusy(true);try{unwrap(await window.dshDesktop.sidecar.restart())}catch(e){setError(e.message)}finally{setBusy(false)}}},"重启并应用")),
        h("div",{className:"dshd-bar"},h("input",{className:"dshd-input",placeholder:"npm 包名，例如 dsh-plugin-memory",value:spec,onChange:e=>setSpec(e.target.value)}),h("button",{className:"dshd-btn dshd-primary",disabled:busy||!spec.trim(),onClick:()=>run(()=>api.install(spec.trim()))},"安装"),h("button",{className:"dshd-btn",disabled:busy||checking,onClick:check},checking?"正在检查…":"检查更新")),
        error&&h("div",{className:"dshd-error"},error),
        operation&&h(OperationLog,{operation}),
        plugins.length===0?h("div",{className:"dshd-empty"},snapshot?"尚未安装个人插件。":"正在读取个人插件…"):h("div",{className:"dshd-cards"},plugins.map(p=>{var u=updates[p.packageName]||p;return h("div",{className:"dshd-card",key:p.packageName},h("div",null,h("div",{className:"dshd-title"},p.packageName,h("span",{className:"dshd-tag"},"个人安装"),u.updateAvailable&&h("span",{className:"dshd-tag dshd-update"},"有更新")),p.description&&h("div",{className:"dshd-desc"},p.description),h("div",{className:"dshd-meta"},h("span",null,"当前 "+(p.installedVersion||"未解析")),h("span",null,p.source),p.toggleable&&h("span",null,p.enabled?"已启用":"已停用"),u.installedRevision&&h("span",null,"提交 "+shortRev(u.installedRevision)),u.latestRevision&&h("span",null,"最新提交 "+shortRev(u.latestRevision)),u.latestVersion&&h("span",null,"最新 "+u.latestVersion),!u.checkable&&u.reason&&h("span",null,u.reason))),h("div",{className:"dshd-actions"},p.toggleable&&h("label",{className:"dshd-switch",title:p.enabled?"已启用，点击停用":"已停用，点击启用"},h("input",{type:"checkbox",checked:Boolean(p.enabled),disabled:busy,onChange:e=>toggle(p,e.target.checked)}),h("span",{className:"dshd-slider"})),u.updateAvailable&&h("button",{className:"dshd-btn",disabled:busy,onClick:()=>confirm(`更新 ${p.packageName}${u.latestVersion?` 到 ${u.latestVersion}`:" 到最新提交"}？`)&&run(()=>api.update(p.packageName,u.updateTarget||u.latestVersion))},"更新"),h("button",{className:"dshd-btn dshd-danger",disabled:busy,onClick:()=>confirm(`移除个人插件 ${p.packageName}？`)&&run(()=>api.remove(p.packageName))},"移除")))}))
      );
    }
    function CommunicationPolicy() {
      var api=window.dshDesktop&&window.dshDesktop.communicationPolicy;var [tier,setTier]=useState("milestones"),[saved,setSaved]=useState("milestones"),[busy,setBusy]=useState(false),[error,setError]=useState("");
      useEffect(()=>{if(!api)return;api.get().then(unwrap).then(data=>{setTier(data.tier);setSaved(data.tier)}).catch(e=>setError(e.message))},[]);
      var save=async()=>{setBusy(true);setError("");try{unwrap(await api.setTier(tier));setSaved(tier);unwrap(await window.dshDesktop.sidecar.restart())}catch(e){setError(e.message)}finally{setBusy(false)}};
      if(!api)return h("div",{className:"dshd-empty"},"沟通策略设置不可用。");
      return h("div",{className:"dshd-policy"},h("div",{className:"dshd-policy-row"},h("div",null,h("h3",null,"Agent 沟通策略"),h("p",{className:"dshd-sub"},"控制 Agent 在执行任务时汇报进度的频率；阻塞反馈和最终总结在所有策略中都会保留。")),h("select",{className:"dshd-select",value:tier,disabled:busy,onChange:e=>setTier(e.target.value)},h("option",{value:"quiet"},"精简"),h("option",{value:"milestones"},"关键节点"),h("option",{value:"frequent"},"频繁"))),h("div",{className:"dshd-bar"},h("p",{className:"dshd-sub"},tier==="quiet"?"不汇报常规步骤，仅在阻塞和完成时反馈。":tier==="frequent"?"每次工具操作前后都会简短反馈。":"在计划、初步探索和验证等关键节点反馈。"),h("button",{className:"dshd-btn dshd-primary",disabled:busy||tier===saved,onClick:save},busy?"正在应用…":"保存并重启")),error&&h("div",{className:"dshd-error"},error));
    }
    function CommandLine() {
      var api=window.dshDesktop&&window.dshDesktop.commandLine;var [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
      var load=async()=>{if(!api)return;try{setStatus(unwrap(await api.status()))}catch(e){setError(e.message)}};useEffect(()=>{load()},[]);
      var act=async(fn)=>{setBusy(true);setError("");try{unwrap(await fn());await load()}catch(e){setError(e.message)}finally{setBusy(false)}};
      if(!api)return h("div",{className:"dshd-empty"},"命令行集成不可用。");
      return h("div",{className:"dshd-command"},
        h("div",{className:"dshd-command-main"},
          h("h3",null,"dsh 命令行入口"),
          h("p",{className:"dshd-sub"},"安全安装到 ~/.local/bin/dsh，复用 Desktop 内置的 Node 与 CLI。"),
          status&&h(React.Fragment,null,
            h("div",{className:"dshd-row"},h("label",null,"状态"),h("span",null,status.state)),
            h("div",{className:"dshd-row"},h("label",null,"位置"),h("code",null,status.path)),
            h("div",{className:"dshd-row"},h("label",null,"PATH"),h("span",null,status.onPath?"已配置":"~/.local/bin 尚未加入 PATH"))
          ),
          error&&h("div",{className:"dshd-error"},error)
        ),
        h("div",{className:"dshd-command-foot"},
          status&&status.managed&&h("button",{className:"dshd-btn dshd-danger",disabled:busy,onClick:()=>confirm("卸载 dsh 命令入口？")&&act(()=>api.remove())},"卸载"),
          h("button",{className:"dshd-btn dshd-primary",disabled:busy,onClick:()=>act(()=>api.install())},status&&status.managed?"修复入口":"安装命令")
        )
      );
    }
    function DesktopSettings() { var [tab,setTab]=useState("plugins"); return h("section",{className:"dshd"},h("div",{className:"dshd-head"},h("div",null,h("h2",null,"Desktop 设置"),h("p",{className:"dshd-sub"},"管理个人插件、Agent 沟通策略和 Desktop 命令行入口。"))),h("div",{className:"dshd-tabs"},h("button",{className:"dshd-tab","data-active":tab==="plugins",onClick:()=>setTab("plugins")},"个人安装"),h("button",{className:"dshd-tab","data-active":tab==="policy",onClick:()=>setTab("policy")},"沟通策略"),h("button",{className:"dshd-tab","data-active":tab==="command",onClick:()=>setTab("command")},"命令行")),tab==="plugins"?h(PersonalPlugins):tab==="policy"?h(CommunicationPolicy):h(CommandLine)); }

    var inject=["slots"];
    function apply(ctx) { ctx.slots.inject("settings.section",()=>ctx.slots.register({name:"settings.section",id:"desktop-personal",order:25,label:"个人扩展"},DesktopSettings)); }
    exports.inject=inject;exports.apply=apply;return module.exports;
  }
});
