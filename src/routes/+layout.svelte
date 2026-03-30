<script>
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import '../app.css';

	const { children } = $props();

	const routes = /** @type {const} */ ([
		['/', 'Renderer'],
		['/editor', 'Editor'],
	]);
</script>

<header>
	<nav>
		{#each routes as [route, label] (route)}
			<a href={resolve(route)} class:selected={page.url.pathname == route}>{label}</a>
		{/each}
	</nav>
</header>
<main>
	{@render children()}
</main>

<style>
	header {
		background-color: orange;
		padding-top: 0.25em;
		padding-bottom: 0.25em;
	}

	nav {
		display: flex;
		justify-content: center;
		gap: 2em;
		margin: 0 auto;
	}

	a {
		border-radius: 1rem;
		padding: 0 0.35rem;
		transition: background-color,color 0.2s linear;
	}

	a:hover, a.selected {
		background-color: purple;
		color: white;
	}

	main {
		display: flex;
		flex-direction: column;
		flex-grow: 1;
		margin-left: 1em;
		margin-right: 1em;
	}
</style>
