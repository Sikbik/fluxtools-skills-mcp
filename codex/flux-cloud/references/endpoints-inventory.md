# Flux Node API — Endpoint Inventory (Generated)

Generated from Flux source: `https://github.com/RunOnFlux/flux`
- Commit: `6faa537d4b9793fade68a6fd0daeddc39d96c0cb`
- File: `ZelBack/src/routes.js`
- Generated: `2026-01-01T17:19:08.612Z`

This inventory is extracted from the Express route table. It is intentionally “complete but shallow”; use the other reference docs for workflows and semantics.

## Summary

- Total routes: **465**
- Categories: **11**

### Categories

- `daemon`: 162
- `apps`: 85
- `flux`: 81
- `syncthing`: 79
- `explorer`: 14
- `id`: 12
- `zelid`: 12
- `benchmark`: 12
- `backup`: 5
- `payment`: 2
- `ioutils`: 1

### Access sections (as labeled in `routes.js`)

- `GET PUBLIC methods`: 129
- `GET PROTECTED API - Fluxnode Owner`: 88
- `GET PROTECTED API - FluxTeam`: 88
- `GET PROTECTED API - User level`: 76
- `POST PROTECTED API - FluxTeam`: 42
- `POST PUBLIC methods route`: 24
- `POST PROTECTED API - FluxNode owner level`: 11
- `POST PROTECTED API - USER LEVEL`: 7

## Fields

- `access`: section label from `routes.js` (public/user/owner/fluxteam).
- `cache`: `apicache` TTL if present in route definition (may differ by deployment).
- `localOnly`: route uses `isLocal` middleware (loopback-only).
- `deprecated`: route comment contains `DEPRECATED`/`DEPERCATED`.

## Routes by category

<details>
<summary><strong>daemon (162)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/daemon/addmultisigaddress` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/addmultisigaddress/:n?/:keysobject?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/addnode/:node?/:command?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/backupwallet/:destination?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/clearbanned` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/createfluxnodekey` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/createmultisig` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/createmultisig/:n?/:keys?` | `GET PUBLIC methods` |  |  |  |  |
| POST | `/daemon/createrawtransaction` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/createrawtransaction/:transactions?/:addresses?/:locktime?/:expiryheight?` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/daemon/createzelnodekey` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| POST | `/daemon/decoderawtransaction` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/decoderawtransaction/:hexstring?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| POST | `/daemon/decodescript` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/decodescript/:hex?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/disconnectnode/:node?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/dumpprivkey/:taddr?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/estimatefee/:nblocks?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/estimatepriority/:nblocks?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/fluxnodecurrentwinner` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| POST | `/daemon/fundrawtransaction` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/fundrawtransaction/:hexstring?` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/daemon/getaddednodeinfo/:dns?/:node?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/getaddressbalance` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/getaddressbalance/:address?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/getaddressdeltas` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/getaddressdeltas/:address?/:start?/:end?/:chaininfo?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/getaddressmempool` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/getaddressmempool/:address?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/getaddresstxids` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/getaddresstxids/:address?/:start?/:end?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/getaddressutxos` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/getaddressutxos/:address?/:chaininfo?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/getbalance/:minconf?/:includewatchonly?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/getbenchmarks` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getbenchstatus` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getbestblockhash` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getblock/:hashheight?/:verbosity?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getblockchaininfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getblockcount` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getblockdeltas/:hash?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getblockhash/:index?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| POST | `/daemon/getblockhashes` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/getblockhashes/:high?/:low?/:noorphans?/:logicaltimes?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getblockheader/:hash?/:verbose?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getblocksubsidy/:height?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getblocktemplate/:jsonrequestobject?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getchaintips` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getconnectioncount` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getdeprecationinfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getdifficulty` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getdoslist` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getfluxnodecount` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getfluxnodeoutputs` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/getfluxnodestatus` | `GET PUBLIC methods` | `60 seconds` |  |  |  |
| GET | `/daemon/getinfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getlocalsolps` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getmempoolinfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getmininginfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getnettotals` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getnetworkhashps/:blocks?/:height?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getnetworkinfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getnetworksolps/:blocks?/:height?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getnewaddress` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/getpeerinfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getrawchangeaddress` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/getrawmempool/:verbose?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getrawtransaction/:txid?/:verbose?` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/daemon/getreceivedbyaddress/:fluxaddress?/:minconf?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/getspentinfo` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/getspentinfo/:txid?/:index?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getstartlist` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/gettransaction/:txid?/:includewatchonly?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/gettxout/:txid?/:n?/:includemempool?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/gettxoutproof/:txids?/:blockhash?` | `GET PUBLIC methods` | `30 seconds` |  |  | comma separated list of txids. For example: /gettxoutproof/abc,efg,asd/blockhash |
| GET | `/daemon/gettxoutsetinfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/getunconfirmedbalance` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/getwalletinfo` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/getzelnodecount` | `GET PUBLIC methods` | `30 seconds` |  | yes | DEPRECATED |
| GET | `/daemon/getzelnodeoutputs` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| GET | `/daemon/getzelnodestatus` | `GET PUBLIC methods` | `60 seconds` |  | yes | DEPRECATED |
| GET | `/daemon/help/:command?` | `GET PUBLIC methods` | `1 hour` |  |  | accept both help/command and ?command=getinfo. If ommited, default help will be displayed. Other calls works in similar way |
| GET | `/daemon/importaddress/:address?/:label?/:rescan?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/importprivkey/:fluxprivkey?/:label?/:rescan?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/importwallet/:filename?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/keypoolrefill/:newsize?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/listaddressgroupings` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/listbanned` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/listfluxnodeconf/:filter?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/listfluxnodes/:filter?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/listlockunspent` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/listreceivedbyaddress/:minconf?/:includeempty?/:includewatchonly?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/listsinceblock/:blockhash?/:targetconfirmations?/:includewatchonly?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/listtransactions/:count?/:from?/:includewatchonly?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/listunspent/:minconf?/:maxconf?/:addresses?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/listzelnodeconf/:filter?` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| GET | `/daemon/listzelnodes/:filter?` | `GET PUBLIC methods` | `30 seconds` |  | yes | DEPRECATED |
| GET | `/daemon/lockunspent/:unlock?/:transactions?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/ping` | `GET PROTECTED API - FluxTeam` |  |  |  | we do not want this to be issued by anyone. |
| GET | `/daemon/prioritisetransaction/:txid?/:prioritydelta?/:feedelta?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/daemon/reindex` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/rescanblockchain/:startheight?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/restart` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/daemon/sendfrom` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/sendfrom/:tofluxaddress?/:amount?/:minconf?/:comment?/:commentto?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/sendmany` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/sendmany/:amounts?/:minconf?/:comment?/:substractfeefromamount?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/sendrawtransaction` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/sendrawtransaction/:hexstring?/:allowhighfees?` | `GET PUBLIC methods` |  |  |  |  |
| POST | `/daemon/sendtoaddress` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/sendtoaddress/:fluxaddress?/:amount?/:comment?/:commentto?/:substractfeefromamount?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/setban/:ip?/:command?/:bantime?/:absolute?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/settxfee/:amount?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/signmessage` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/signmessage/:taddr?/:message?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/signrawtransaction` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/signrawtransaction/:hexstring?/:prevtxs?/:privatekeys?/:sighashtype?/:branchid?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/start` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/daemon/startbenchmark` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/daemon/startdeterministicfluxnode/:alias?/:lockwallet?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/startdeterministiczelnode/:alias?/:lockwallet?` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| GET | `/daemon/startfluxnode/:set?/:lockwallet?/:alias?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/startzelnode/:set?/:lockwallet?/:alias?` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| GET | `/daemon/stop` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/stopbenchmark` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/daemon/submitblock` | `POST PROTECTED API - USER LEVEL` |  |  |  |  |
| GET | `/daemon/submitblock/:hexdata?/:jsonparametersobject?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/daemon/validateaddress/:fluxaddress?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/verifychain/:checklevel?/:numblocks?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/verifymessage` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/daemon/verifymessage/:fluxaddress?/:signature?/:message?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/verifytxoutproof/:proof?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/viewdeterministicfluxnodelist/:filter?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/daemon/viewdeterministiczelnodelist/:filter?` | `GET PUBLIC methods` | `30 seconds` |  | yes | DEPRECATED |
| GET | `/daemon/zcbenchmark/:benchmarktype?/:samplecount?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/daemon/zcrawjoinsplit` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/zcrawjoinsplit/:rawtx?/:inputs?/:outputs?/:vpubold?/:vpubnew?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zcrawkeygen` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/zcrawreceive` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/zcrawreceive/:zcsecretkey?/:encryptednote?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zcsamplejoinsplit` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zexportkey/:zaddr?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zexportviewingkey/:zaddr?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zgetbalance/:address?/:minconf?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zgetmigrationstatus` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zgetnewaddress/:type?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zgetoperationresult/:operationid?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zgetoperationstatus/:operationid?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zgettotalbalance/:minconf?/:includewatchonly?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zimportkey/:zkey?/:rescan?/:startheight?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zimportviewingkey/:vkey?/:rescan?/:startheight?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zimportwallet/:filename?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zlistaddresses/:includewatchonly?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zlistoperationids` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zlistreceivedbyaddress/:address?/:minconf?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zlistunspent/:minconf?/:maxonf?/:includewatchonly?/:addresses?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zmergetoaddress/:fromaddresses?/:toaddress?/:fee?/:transparentlimit?/:shieldedlimit?/:memo?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/daemon/zsendmany` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/daemon/zsendmany/:fromaddress?/:amounts?/:minconf?/:fee?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zsetmigration/:enabled?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zshieldcoinbase/:fromaddress?/:toaddress?/:fee?/:limit?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/daemon/zvalidateaddress/:zaddr?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |

</details>

<details>
<summary><strong>apps (85)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/apps/appchanges/:appname?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/apps/appendbackuptask` | `GET PROTECTED API - User level` |  |  |  |  |
| POST | `/apps/appendrestoretask` | `GET PROTECTED API - User level` |  |  |  |  |
| POST | `/apps/appexec` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/appinspect/:appname?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/applog/:appname?/:lines?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/applogpolling/:appname?/:lines?/:since?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/appmonitor/:appname?/:range?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/appmonitorstream/:appname?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/apporiginalowner/:appname?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/appowner/:appname?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/apppause/:appname?/:global?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/apps/appregister` | `POST PROTECTED API - USER LEVEL` |  |  |  |  |
| GET | `/apps/appremove/:appname?/:force?/:global?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/apprestart/:appname?/:global?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/appspecifications/:appname/:decrypt?` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/apps/appsresources` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/appstart/:appname?/:global?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/appstats/:appname?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/appstop/:appname?/:global?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/apptop/:appname?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/appunpause/:appname?/:global?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/apps/appupdate` | `POST PROTECTED API - USER LEVEL` |  |  |  |  |
| GET | `/apps/availableapps` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| POST | `/apps/calculatefiatandfluxprice` | `GET PUBLIC methods` |  |  |  | returns price in usd and flux for both new registration of app and update of app |
| POST | `/apps/calculateprice` | `GET PUBLIC methods` |  |  |  | returns price in flux for both new registration of app and update of app |
| POST | `/apps/checkdockerexistance` | `POST PROTECTED API - USER LEVEL` |  |  |  |  |
| GET | `/apps/checkhashes` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/createfluxnetwork` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/createfolder/:appname?/:component?/:folder?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/deploymentinformation` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/downloadfile/:appname?/:component?/:file?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/downloadfolder/:appname?/:component?/:folder?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/enterprisenodes` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/fluxshare/createfolder/:folder?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/downloadfolder/:folder?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/fileexists/:file?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/getfile/:file?/:token?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/getfolder/:folder?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/removefile/:file?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/removefolder/:folder?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/rename/:oldpath?/:newname?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/sharedfiles` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/sharefile/:file?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/stats` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxshare/unsharefile/:file?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/apps/fluxshare/uploadfile/:folder?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/fluxusage` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/getappspecsusdprice` | `GET PUBLIC methods` | `30 minutes` |  |  |  |
| GET | `/apps/getfolderinfo/:appname?/:component?/:folder?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/apps/getpublickey` | `POST PROTECTED API - USER LEVEL` |  |  |  |  |
| GET | `/apps/globalappsspecifications/:hash?/:owner?/:appname?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/hashes` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/installapplocally/:appname?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/installedapps/:appname?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/installingerrorslocation/:appname?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/installingerrorslocations` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/installinglocation/:appname?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/installinglocations` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/latestspecificationversion` | `GET PUBLIC methods` | `5 minutes` |  |  |  |
| GET | `/apps/listallapps` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/listappsimages` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/listrunningapps` | `GET PUBLIC methods` | `5 seconds` |  |  |  |
| GET | `/apps/location/:appname?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/locations` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/messagescount/:appowner?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/permanentmessages/:hash?/:owner?/:appname?` | `GET PUBLIC methods` | `2 minutes` |  |  |  |
| GET | `/apps/reconstructhashes` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/redeploy/:appname?/:force?/:global?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/redeploycomponent/:appname?/:component?/:force?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/registrationinformation` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/apps/reindexglobalappsinformation` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/reindexglobalappslocation` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/removeobject/:appname?/:component?/:object?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/renameobject/:appname?/:component?/:oldpath?/:newname?` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/requestmessage/:hash` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/rescanglobalappsinformation/:blockheight?/:removelastinformation?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/startmonitoring/:appname?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/stopmonitoring/:appname?/:deletedata?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/temporarymessages/:hash?` | `GET PUBLIC methods` | `5 seconds` |  |  |  |
| GET | `/apps/testappinstall/:appname?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/apps/updatetolatestspecs/:appname` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| POST | `/apps/verifyappregistrationspecifications` | `GET PUBLIC methods` |  |  |  | returns formatted app specifications |
| POST | `/apps/verifyappupdatespecifications` | `GET PUBLIC methods` |  |  |  | returns formatted app specifications |
| GET | `/apps/whitelistedrepositories` | `GET PUBLIC methods` | `30 seconds` |  |  |  |

</details>

<details>
<summary><strong>flux (81)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/flux/addoutgoingpeer/:ip?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/addpeer/:ip?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/adjustapiport/:apiport?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  | note this essentially rebuilds flux use with caution! |
| POST | `/flux/adjustblockedports` | `GET PROTECTED API - Fluxnode Owner` |  |  |  | note this essentially rebuilds flux use with caution! |
| POST | `/flux/adjustblockedrepositories` | `GET PROTECTED API - Fluxnode Owner` |  |  |  | note this essentially rebuilds flux use with caution! |
| GET | `/flux/adjustkadena/:account?/:chainid?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  | note this essentially rebuilds flux use with caution! |
| GET | `/flux/adjustrouterip/:routerip?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  | note this essentially rebuilds flux use with caution! |
| GET | `/flux/allowport/:port?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/apiport` | `GET PUBLIC methods` | `1 day` |  |  |  |
| GET | `/flux/backendfolder` | `GET PROTECTED API - FluxTeam` |  | yes |  |  |
| GET | `/flux/benchmarkdebug` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/blockedports` | `GET PUBLIC methods` | `1 day` |  |  |  |
| GET | `/flux/blockedrepositories` | `GET PUBLIC methods` | `1 day` |  |  |  |
| POST | `/flux/broadcastmessage` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/broadcastmessage/:data?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/flux/broadcastmessagetoincoming` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/broadcastmessagetoincoming/:data?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/flux/broadcastmessagetooutgoing` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/broadcastmessagetooutgoing/:data?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/flux/checkappavailability` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/flux/checkcommunication` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/checkfluxavailability/:ip?/:port?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/connectedpeers` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/connectedpeersinfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/daemondebug` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/debuglog` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/dosstate` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/enterdevelopment` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/entermaster` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/errorlog` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/fluxids` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/geolocation` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/getgateway` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/getip` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/getmap` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/hardupdateflux` | `GET PROTECTED API - FluxTeam` |  |  |  | method shall be called only if flux version is obsolete and updatezeflux is not working correctly |
| GET | `/flux/id` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/incomingconnections` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/incomingconnectionsinfo` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/info` | `GET PUBLIC methods` | `60 seconds` |  |  |  |
| GET | `/flux/infolog` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/ip` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/isarcaneos` | `GET PROTECTED API - FluxTeam` | `1 day` |  |  |  |
| GET | `/flux/kadena` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| POST | `/flux/keepupnpportsopen` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/flux/mapport/:port?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/marketplaceurl` | `GET PUBLIC methods` | `1 day` |  |  |  |
| GET | `/flux/nodejsversions` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/nodetier` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/pgp` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/rebuildhome` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/reindexdaemon` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/flux/removeincomingpeer/:ip?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/removepeer/:ip?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/restart` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/restartbenchmark` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/restartdaemon` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/routerip` | `GET PUBLIC methods` | `1 day` |  |  |  |
| GET | `/flux/softupdateflux` | `GET PROTECTED API - FluxTeam` |  |  |  | method shall be called only if flux version is obsolete. |
| GET | `/flux/softupdatefluxinstall` | `GET PROTECTED API - FluxTeam` |  |  |  | method shall be called only if flux version is obsolete. |
| GET | `/flux/startbenchmark` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/startdaemon` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/staticip` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| POST | `/flux/streamchain` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/flux/streamchainpreparation` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/flux/systemuptime` | `GET PROTECTED API - FluxTeam` | `30 seconds` |  |  |  |
| GET | `/flux/tailbenchmarkdebug` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/taildaemondebug` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/taildebuglog` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/tailerrorlog` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/tailinfolog` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/tailwarnlog` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/timezone` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/flux/unmapport/:port?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/updatebenchmark` | `GET PROTECTED API - FluxTeam` |  |  |  | method shall be called only if benchamrk version is obsolete |
| GET | `/flux/updatedaemon` | `GET PROTECTED API - FluxTeam` |  |  |  | method shall be called only if daemon version is obsolete |
| GET | `/flux/updateflux` | `GET PROTECTED API - FluxTeam` |  |  |  | method shall be called only if flux version is obsolete. |
| GET | `/flux/uptime` | `GET PROTECTED API - FluxTeam` | `30 seconds` |  |  |  |
| GET | `/flux/version` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/flux/warnlog` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/flux/zelid` | `GET PUBLIC methods` | `30 seconds` |  |  | DEPERCATED |

</details>

<details>
<summary><strong>syncthing (79)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/syncthing/cluster/pending/devices` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/cluster/pending/devices` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/cluster/pending/folders` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/cluster/pending/folders` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/config` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config/defaults/device` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/config/defaults/device` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config/defaults/folder` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/config/defaults/folder` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config/defaults/ignores` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/config/defaults/ignores` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/syncthing/config/devices` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config/devices/:id?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/config/folders` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config/folders/:id?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/config/gui` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/config/gui` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config/ldap` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/config/ldap` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config/options` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/config/options` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/config/restart-required` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/db/browse/:folder?/:levels?/:prefix?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/db/completion/:folder?/:device?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/db/file/:folder?/:file?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/db/ignores` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/db/ignores/:folder?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/db/localchanged/:folder?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/db/need/:folder?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/db/override` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/syncthing/db/prio` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/db/remoteneed/:folder?/:device?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/db/revert` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/syncthing/db/scan` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/db/status/:folder?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/debug/cpuprof` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/debug/file` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/debug/heapprof` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/debug/httpmetrics` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/debug/peercompletion` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/debug/support` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/deviceid` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/events/:events?/:since?/:limit?/:timeout?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/events/disk` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/folder/errors/:folder?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/folder/versions` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/folder/versions/:folder?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/health` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/meta` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/metrics` | `GET PROTECTED API - FluxTeam` | `10 seconds` |  |  |  |
| GET | `/syncthing/metrics/health` | `GET PROTECTED API - FluxTeam` | `10 seconds` |  |  |  |
| GET | `/syncthing/metrics/history/:limit?` | `GET PROTECTED API - FluxTeam` | `10 seconds` |  |  |  |
| GET | `/syncthing/peer/diagnostics` | `GET PROTECTED API - FluxTeam` | `10 seconds` |  |  |  |
| GET | `/syncthing/stats/device` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/stats/folder` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/svc/:deviceid?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/svc/random/string/:length?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/svc/report` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/browse/:current?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/connections` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/debug/:enable?/:disable?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/discovery/:device?/:addr?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/system/error` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/system/error/:message?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/error/clear` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/log/:since?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/logtxt/:since?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/paths` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/pause/:device?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/ping` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/reset/:folder?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/restart` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/resume/:device?` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/shutdown` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/status` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/syncthing/system/upgrade` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/syncthing/system/upgrade` | `POST PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/syncthing/system/version` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |

</details>

<details>
<summary><strong>explorer (14)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/explorer/alladdresses` | `GET PUBLIC methods` |  |  |  | app.get('/explorer/alladdresses', (req, res) => { |
| GET | `/explorer/alladdresseswithtransactions` | `GET PUBLIC methods` |  |  |  | app.get('/explorer/alladdresseswithtransactions', (req, res) => { |
| GET | `/explorer/allutxos` | `GET PUBLIC methods` |  |  |  | app.get('/explorer/allutxos', (req, res) => { |
| GET | `/explorer/balance/:address?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/explorer/fusion/coinbase/:address?` | `GET PUBLIC methods` | `30 seconds` |  | yes | deprecated |
| GET | `/explorer/fusion/coinbase/all` | `GET PUBLIC methods` | `30 seconds` |  |  | app.get('/explorer/fusion/coinbase/all', cache('30 seconds'), (req, res) => { |
| GET | `/explorer/issynced` | `POST PROTECTED API - FluxTeam` | `30 seconds` |  |  |  |
| GET | `/explorer/reindex/:reindexapps?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/explorer/rescan/:blockheight?/:rescanapps?` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/explorer/restart` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/explorer/scannedheight` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/explorer/stop` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/explorer/transactions/:address?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |
| GET | `/explorer/utxo/:address?` | `GET PUBLIC methods` | `30 seconds` |  |  |  |

</details>

<details>
<summary><strong>id (12)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/id/activeloginphrases` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/id/checkprivilege` | `POST PUBLIC methods route` |  |  |  |  |
| GET | `/id/emergencyphrase` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/id/loggedsessions` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/id/loggedusers` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/id/loginphrase` | `GET PUBLIC methods` |  |  |  |  |
| GET | `/id/logoutallsessions` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/id/logoutallusers` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| GET | `/id/logoutcurrentsession` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| POST | `/id/logoutspecificsession` | `POST PROTECTED API - USER LEVEL` |  |  |  | requires the knowledge of a session loginPhrase so users level is sufficient and user cannot logout another user as he does not know the loginPhrase. |
| POST | `/id/providesign` | `POST PUBLIC methods route` |  |  |  |  |
| POST | `/id/verifylogin` | `POST PUBLIC methods route` |  |  |  |  |

</details>

<details>
<summary><strong>zelid (12)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/zelid/activeloginphrases` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| POST | `/zelid/checkprivilege` | `POST PUBLIC methods route` |  |  | yes | DEPRECATED |
| GET | `/zelid/emergencyphrase` | `GET PUBLIC methods` |  |  | yes | DEPRECATED |
| GET | `/zelid/loggedsessions` | `GET PROTECTED API - User level` | `30 seconds` |  | yes | DEPRECATED |
| GET | `/zelid/loggedusers` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| GET | `/zelid/loginphrase` | `GET PUBLIC methods` |  |  | yes | DEPRECATED |
| GET | `/zelid/logoutallsessions` | `GET PROTECTED API - User level` | `30 seconds` |  | yes | DEPRECATED |
| GET | `/zelid/logoutallusers` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| GET | `/zelid/logoutcurrentsession` | `GET PROTECTED API - User level` | `30 seconds` |  | yes | DEPRECATED |
| POST | `/zelid/logoutspecificsession` | `POST PROTECTED API - USER LEVEL` |  |  | yes | DEPRECATED |
| POST | `/zelid/providesign` | `POST PUBLIC methods route` |  |  | yes | DEPRECATED |
| POST | `/zelid/verifylogin` | `POST PUBLIC methods route` |  |  | yes | DEPRECATED |

</details>

<details>
<summary><strong>benchmark (12)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/benchmark/getbenchmarks` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/benchmark/getinfo` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/benchmark/getstatus` | `GET PROTECTED API - User level` | `30 seconds` |  |  |  |
| GET | `/benchmark/help/:command?` | `GET PROTECTED API - User level` | `1 hour` |  |  |  |
| GET | `/benchmark/restart` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/benchmark/restartnodebenchmarks` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| POST | `/benchmark/signfluxnodetransaction` | `POST PROTECTED API - FluxNode owner level` |  |  |  |  |
| GET | `/benchmark/signfluxnodetransaction/:hexstring?` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |
| POST | `/benchmark/signzelnodetransaction` | `POST PROTECTED API - FluxNode owner level` |  |  | yes | DEPRECATED |
| GET | `/benchmark/signzelnodetransaction/:hexstring?` | `GET PROTECTED API - Fluxnode Owner` |  |  | yes | DEPRECATED |
| GET | `/benchmark/start` | `GET PROTECTED API - FluxTeam` |  |  |  |  |
| GET | `/benchmark/stop` | `GET PROTECTED API - Fluxnode Owner` |  |  |  |  |

</details>

<details>
<summary><strong>backup (5)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/backup/downloadlocalfile/:filepath?/:appname?` | `GET PROTECTED API - User level` |  |  |  |  |
| GET | `/backup/getlocalbackuplist/:path?/:multiplier?/:decimal?/:number?/:appname?` | `GET PROTECTED API - User level` |  |  |  |  |
| GET | `/backup/getremotefilesize/:fileurl?/:multiplier?/:decimal?/:number?/:appname?` | `GET PROTECTED API - User level` |  |  |  |  |
| GET | `/backup/getvolumedataofcomponent/:appname?/:component?/:multiplier?/:decimal?/:fields?` | `GET PROTECTED API - User level` |  |  |  |  |
| GET | `/backup/removebackupfile/:filepath?/:appname?` | `GET PROTECTED API - User level` |  |  |  |  |

</details>

<details>
<summary><strong>payment (2)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/payment/paymentrequest` | `POST PUBLIC methods route` |  |  |  |  |
| POST | `/payment/verifypayment` | `POST PUBLIC methods route` |  |  |  |  |

</details>

<details>
<summary><strong>ioutils (1)</strong></summary>

| Method | Path | Access | Cache | Local | Deprecated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/ioutils/fileupload/:type?/:appname?/:component?/:folder?/:filename?` | `GET PROTECTED API - User level` |  |  |  |  |

</details>

