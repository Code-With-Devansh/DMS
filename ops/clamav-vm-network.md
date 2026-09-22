# ClamAV VM — OCI network setup

Two VMs, both on Oracle Cloud: the **app VM** (Postgres/Redis/API/worker,
`docker-compose.yml`) and the **clamav VM** (just ClamAV,
`docker-compose.clamav.yml`, 1GB RAM). clamd's own wire protocol has **no
authentication** — the network boundary described here is the entire access
control for it. Do not skip it, and never give the clamav VM a public IP.

## 1. Same VCN (recommended)

If both VMs are already in the same VCN, they can reach each other over
their private IPs with nothing extra — OCI routes intra-VCN traffic locally.
If they're in different VCNs (including different regions), you need a
Local Peering Gateway (same region) or Remote Peering Gateway (cross-region)
between the two VCNs first; that's a bigger step than this doc covers — the
simplest fix is usually just putting both VMs in the same VCN if nothing else
requires otherwise.

## 2. Network Security Group (preferred over a plain Security List rule)

An NSG rule can name the app VM's *own* NSG as the source, instead of a bare
IP/CIDR — so it keeps working if the app VM is ever recreated with a new
private IP (common after a reboot/resize in some configs, or a redeploy).

**Console:** Networking → Virtual Cloud Networks → your VCN → Network
Security Groups → Create Network Security Group.

Create two NSGs:
- `app-nsg` — attach to the app VM's VNIC.
- `clamav-nsg` — attach to the clamav VM's VNIC.

Add one ingress rule to `clamav-nsg`:

| Field | Value |
|---|---|
| Source Type | Network Security Group |
| Source NSG | `app-nsg` |
| IP Protocol | TCP |
| Destination Port Range | 3310 |

That's the only inbound rule `clamav-nsg` needs. No SSH/22 rule unless you
also want to manage that VM remotely — if so, scope it to your own IP, not
0.0.0.0/0.

**CLI equivalent** (if you're scripting this rather than using the console):

```bash
oci network nsg create --compartment-id <compartment-ocid> --vcn-id <vcn-ocid> \
  --display-name clamav-nsg

oci network nsg rules add --nsg-id <clamav-nsg-ocid> --security-rules '[{
  "direction": "INGRESS",
  "protocol": "6",
  "isStateless": false,
  "source": "<app-nsg-ocid>",
  "sourceType": "NETWORK_SECURITY_GROUP",
  "tcpOptions": { "destinationPortRange": { "min": 3310, "max": 3310 } }
}]'
```

Then attach each VM's VNIC to its NSG: Compute → Instances → (VM) →
Attached VNICs → (VNIC) → Edit VNIC → Network Security Groups.

## 3. Fallback: plain Security List rule (simpler, less durable)

If you'd rather not set up NSGs: add an ingress rule directly to the
clamav VM's **subnet** Security List, restricted to the app VM's private IP
as a /32:

| Field | Value |
|---|---|
| Source CIDR | `<app VM private IP>/32` |
| IP Protocol | TCP |
| Destination Port Range | 3310 |

Downside versus the NSG approach: this breaks silently if the app VM's
private IP ever changes, since the rule doesn't know about the VM itself,
just that one address.

## 4. Confirm no public exposure

- clamav VM: no public IP assigned (Compute → Instances → check "Public IP
  address" is empty), or if it must have one for SSH management, make sure
  the Security List/NSG does NOT allow 3310 from `0.0.0.0/0` — only from the
  app VM's private IP/NSG as above.
- `docker-compose.clamav.yml` binds the container to `CLAMAV_BIND_IP` (set in
  `.env` on that VM — see `env.clamav.example`), not `0.0.0.0`, as a second
  layer under the OCI rules.

## 5. Wire up the app VM

On the app VM, set in `.env`:

```
CLAMAV_HOST=<clamav VM's private IP>
CLAMAV_PORT=3310
```

## 6. Verify before trusting it

From the app VM, after both are deployed:

```bash
node scripts/check-clamav.js
```

Should print `OK — clamd responded PONG.` If it doesn't, the error message
tells you which of (VM up / NSG rule / CLAMAV_HOST value) to check first.

Worth knowing: there's no compose-level `depends_on`/healthcheck gating the
worker on clamav readiness anymore (compose can't heathcheck across two
separate hosts) — `src/processing/clamav.js` is fail-closed instead: a
connection failure throws and the job retries via BullMQ rather than treating
an unreachable clamd as "file is clean." A misconfigured NSG rule shows up as
jobs stuck retrying in `SCANNING`, not as documents silently skipping the
scan.
