# Gateway ingress operator guide

`cealctl` runs on the Gateway/admin host. It can construct and read-only probe
one organization-controlled Gateway route; it does not receive DNS, edge,
tunnel, firewall, reverse-proxy, or provider credentials.

This is a source/release contract. It does not add `ingress` to an already
installed binary: first install a signed release whose `cealctl --help` lists
the command, then use that installed help as the executable authority.

Start from installed command discovery, then select one mode:

```sh
cealctl ingress --help
cealctl ingress plan \
  --gateway-host gateway.acme.example \
  --org acme \
  --instance production \
  --mode direct-origin
```

The three supported planning modes describe the customer's existing network
choice, not separate Ceal products:

- `direct-origin`: customer DNS and a TLS reverse proxy reach the Gateway host.
- `outbound-tunnel`: a customer-selected edge/tunnel connector reaches the
  Gateway host outbound.
- `private-network`: VPN, private DNS, or Zero-Trust routing reaches the same
  TLS hostname.

The plan emits the one canonical control base:

```text
https://<gateway-host>/<org>/<instance>
```

and its personal-client endpoint:

```text
https://<gateway-host>/<org>/<instance>/api/ceal/v1
```

The customer configures the selected edge/network path and keeps Gateway
backends loopback-only behind its ingress proxy. The public Ceal landing host
(`ceal.borca.ai` and its subdomains) is invalid for this role.

After DNS/TLS/proxy or the private route exists, run the anonymous transport
probe:

```sh
cealctl ingress verify \
  --gateway-host gateway.acme.example \
  --org acme \
  --instance production \
  --mode direct-origin
```

It sends one credential-free HTTPS `GET` to the instance route, renders only a
status code, and never reads or prints a response body. Any response establishes
only that the selected network path reached an HTTPS responder: an edge may
produce its own 401/403. It does not prove Gateway routing or identity,
operator authentication, connector readiness, audit custody, or a provider
action.

Only after this transport check should the Gateway operator provision the exact
same hostname in the Gateway deployment, apply the Gateway service under its
normal change boundary, log in locally with `cealctl`, and enroll a client.
