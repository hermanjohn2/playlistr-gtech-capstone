import React, { Component } from 'react';
import queryString from 'query-string';

import API from '../../utils/API';
import SpotifyAPI from '../../utils/SpotifyAPI';

import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Alert from 'react-bootstrap/Alert';

import TrackSearch from '../../components/TrackSearch';
import Player from '../../components/Player';
import ListGroup from 'react-bootstrap/esm/ListGroup';
import RoomUser from '../../components/RoomUser';

import './style.css';

import apiUrl from '../../apiConfig';
import socketIOClient from 'socket.io-client';

const ENDPOINT = apiUrl;

class Room extends Component {
	constructor() {
		super();

		let parsedUrl = queryString.parse(window.location.search);
		let token = parsedUrl.access_token;
		let roomId = parsedUrl.room_id;

		this.state = {
			user: {},
			addedTracks: [],
			accessToken: token,
			roomId: roomId,
			userSong: {},
			item: {
				album: {
					images: [{ url: './images/logo.jpg' }]
				},
				name: '',
				artists: [{ name: '' }],
				duration_ms: 0
			},
			playbackQueueStatus: 'Paused',
			progress: 0,
			roomUsers: [],
			roomHost: {},
			roomSong: {},
			alertShow: false
		};
	}

	// When component mounts, app will connect to socket and user state will be set to response from API call. Then the playlist will be created.

	// When the current user creates & joins the room, add them to the array of current users on the server (in handler.js)
	// When another user joins the existing room, they're also added to the array
	// The new user will see what the host is currently playing upon joining the room
	// All users then need to see users already in the room
	componentDidMount() {
		SpotifyAPI.getUserData(this.state.accessToken)
			.then(res => this.setState({ user: res.data }))
			.then(() => {
				this.joinRoomSockets();
			});

		this.getCurrentlyPlaying(this.state.accessToken);

		// Queries DB for tracks added to current room
		this.getRoomTracks(this.state.roomId);
	}

	componentWillUnmount() {
		let socket = socketIOClient(ENDPOINT);

		// Close connection when component unmounts
		return () => socket.disconnect();
	}

	joinRoomSockets = () => {
		// Connect to socket
		let socket = socketIOClient(ENDPOINT);

		// Upon connecting to socket, emit that the current user has joined current room
		socket.on('connect', () => {
			socket.emit('join room', this.state.roomId, this.state.user);
		});

		// Listen for status updates for when users join or leave room
		socket.on('user status', message => {
			console.log('Status update: ', message);
		});

		// Listen for the room's current users in order to set host
		// Then set the host of the room to the first person in the currentUsers array
		socket.on('current users', currentUsers => {
			this.setState({ roomUsers: currentUsers }, () => {
				console.log('Users in room:', this.state.roomUsers);

				// The first user in the usersArray is the roomHost. If the host leaves, the next person becomes the first in usersArray, becoming the roomHost
				this.setState({ roomHost: this.state.roomUsers[0] }, () => {
					console.log('Current host: ', this.state.roomHost.display_name);
				});
			});
		});

		// Upon joining, listen for the room's current song
		// Only the host sets the roomSong - any users who join get the host's song set to their roomSong
		socket.on('room song', song => {
			console.log('Room song: ', song.item.name);
			this.setState({ roomSong: song });
		});
	};

	// GETs track that is currently playing on the users playback queue (Spotify), sets the state with the returned data, and then updates the Play Queue to highlight the track currently playing on the queue
	getCurrentlyPlaying = token => {
		SpotifyAPI.getUserQueueData(token)
			.then(res => {
				this.setState(
					{
						item: res.data.item,
						playbackQueueStatus: res.data.is_playing,
						progress: res.data.progress_ms,
						userSong: res.data
					},
					() => {
						// Set roomSong to the host's song every time getCurrentlyPlaying is called
						this.setRoomSong();
						console.log('The host is playing: ', this.state.roomSong);
					}
				);
			})
			.then(() => this.handleQueueRender())
			.then(() => this.updatePlayedStatus())
			.catch(err => {
				if (err) {
					this.setState({ alertShow: true });
				}
			});
	};

	// The host sets the roomSong to what they are currently listening to
	setRoomSong = () => {
		// Object.keys checks if there are object properties - otherwise, an empty object causes errors if the host is not playing a song
		if (this.state.user.id === this.state.roomHost.id && Object.keys(this.state.userSong).length > 0) {
			this.setState({ roomSong: this.state.userSong }, () => {
				let socket = socketIOClient(ENDPOINT);

				socket.emit('host song', {
					song: this.state.roomSong,
					roomId: this.state.roomId
				});
			});
		}
	};

	getRoomTracks = roomId => {
		API.getTracks(roomId).then(res => {
			this.setState({ addedTracks: res.data.addedTracks });
		});
	};

	// Using timeout to determine when the track is done playing
	// When time is up, we update track played status in DB and call getCurrently playing to begin the updating process again
	updatePlayedStatus = () => {
		let timeRemaining = this.state.item.duration_ms - this.state.progress;

		let trackToUpdate = this.state.item.id;

		setTimeout(() => {
			API.updateTrackPlayedStatus(this.state.roomId, trackToUpdate).catch(err => console.log(err));

			this.getCurrentlyPlaying(this.state.accessToken);
		}, timeRemaining);
	};

	// Using the state of addedTracks to conditionally render the Play Queue.
	handleQueueRender = () => {
		let addedTracks = this.state.addedTracks;

		if (!addedTracks.length) {
			return <p>Add a track to get started...</p>;
		} else {
			return addedTracks.map(track => (
				<ListGroup.Item
					className="play-queue-item"
					key={track._id}
					id={track.spotifyId}
					variant={this.setVariant(
						track.spotifyId,
						this.state.item.id,
						'warning',
						'dark'
					)}>
					{track.info}
				</ListGroup.Item>
			));
		}
	};

	// Helper method that compares two id's and sets a variant based on result
	setVariant = (id, comparedId, variantA, variantB) => {
		if (id === comparedId) return variantA;
		return variantB;
	};

	handleAlertClick = () => {
		this.getCurrentlyPlaying(this.state.accessToken);

		this.setState({ alertShow: false });
	};

	render() {
		return (
			<div>
				<Container className="py-3">
					<Row>
						<Col xs={12} md={6}>
							<h1>Current Room: {this.state.roomId} </h1>
						</Col>
						<Col xs={12} md={6}>
							<TrackSearch
								token={this.state.accessToken}
								roomId={this.state.roomId}
								getRoomTracks={this.getRoomTracks}
								getCurrentlyPlaying={this.getCurrentlyPlaying}
								currentlyPlayingTrack={this.state.item}
							/>
						</Col>
					</Row>
				</Container>
				<Container>
					<Row>
						<Col xs={6} md={6}>
							<img
								className="now-playing-img"
								src={this.state.item.album.images[0].url}
								alt="Track album artwork"
							/>
						</Col>
						<Col xs={6} md={6}>
							<div className="play-queue">
								<h1>Play Queue</h1>

								<ListGroup className="play-queue-list">
									{this.handleQueueRender()}
								</ListGroup>
							</div>
						</Col>
					</Row>
				</Container>
				<Container>
					<Row>
						<Col xs={12} sm={6} md={6}>
							<Alert show={this.state.alertShow} variant="success">
								<h5>
									Please open the Spotify App and play a track to
									get started.
								</h5>

								<div className="d-flex justify-content-end">
									<button
										onClick={() => this.handleAlertClick()}
										variant="outline-success">
										Ready
									</button>
								</div>
							</Alert>
							<Player
								token={this.state.accessToken}
								item={this.state.item}
								isPlaying={this.state.isPlaying}
								progress={this.state.progress}
								getCurrentlyPlaying={this.getCurrentlyPlaying}
							/>
						</Col>
						<Col xs={12} sm={6} md={6}>
							<Row className="pt-5">
								{this.state.roomUsers.map(user => (
									<RoomUser
										key={user.id}
										user={user}
										avatar={user.images[0].url}
										name={user.display_name}
									/>
								))}
							</Row>
						</Col>
					</Row>
				</Container>
			</div>
		);
	}
}

export default Room;
